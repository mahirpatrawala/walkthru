// A vector plan's printed room sizes against the walls drawn around them. Dimension lines are the best evidence of scale, but brochure
// plans have none; what they have is a size printed in every room and walls drawn around it. From each label the walls around it are
// found (the same ray vote as the picture path, on the importer's wall bitmap), and one scale is fitted to all the rooms at once
// (RANSAC, pixels/fit.ts). Three uses: the scale the importer guessed from wall thickness is replaced by this one; a room whose printed
// size agrees with its walls on a scale fitted without it, from at least three other rooms, is verified; a room whose printed size
// disagrees by more than 5% is a conflict. Nothing here knows a drawing. Pure TypeScript.
import type { ImportResult } from '../import/types';
import type { ProposeTrace } from '../import/propose';
import { parseLabels } from '../import/labels';
import { Bitmap, WALL } from '../import/bitmap';
import { agrees, clearlyWrong, fitScale, labelFit, looFit } from './pixels/fit';
import type { Evidence, ScaleFit } from './pixels/fit';
import { roomSpans } from './local/ink';
import type { Status } from './types';

export interface LabelMeasure {
  /** the finding's id in the importer's proposal */ id: string; label: string;
  printed: { w: number; l: number };
  /** the walls around the label, page units */ spanPt: { w: number; h: number } | null;
  /** the walls' box around the label, page units */ boxPt: [number, number, number, number] | null;
}
export interface LabelGeometry {
  fit: ScaleFit | null; measures: LabelMeasure[];
  status: Map<string, Status>; notes: Map<string, string>;
  /** page units per metre fitted from labels and walls, when at least three rooms agree on one */
  ptPerM: number | null;
}
// the verified band is the inner half of the 2% tolerance (as verify.ts does for dimensions): what is called checked must be right with room to spare
const VERIFY_REL = 0.01, FIT_REL = 0.03, CONFLICT_REL = 0.05;

export function labelGeometry(result: ImportResult, trace: ProposeTrace): LabelGeometry {
  const none: LabelGeometry = { fit: null, measures: [], status: new Map(), notes: new Map(), ptPerM: null };
  const plan = trace.plan, walls = trace.walls;
  if (!plan || !walls || !trace.frame) return none;
  // the wall polygons drawn at about 1/1500 of the page, finer than the importer's own bitmap (which is a quarter of a wall thick)
  const bm = new Bitmap(plan.width, plan.height, Math.max(0.4, Math.max(plan.width, plan.height) / 1600));
  for (const r of walls.coverage) bm.fillRing(r, WALL);
  const mask = new Uint8Array(bm.nx * bm.ny);
  for (let i = 0; i < mask.length; i++) mask[i] = bm.data[i] === WALL ? 1 : 0;
  const { rooms: labels } = parseLabels(plan.texts);
  const cap = Math.round(0.5 * Math.max(bm.nx, bm.ny));
  const measures: LabelMeasure[] = [];
  const used = new Set<string>();
  for (const f of result.extras.rooms) {
    if (!f.labelDims) continue;
    const l = labels.find((x) => !used.has(x.block.lines.map((q) => q.text).join('|')) && x.dims && Math.abs(x.dims.w - f.labelDims!.w) < 1e-6 && Math.abs(x.dims.l - f.labelDims!.l) < 1e-6 && x.name.toLowerCase().replace(/[^a-z]/g, '') === f.label.toLowerCase().replace(/[^a-z]/g, ''));
    if (!l) continue;
    used.add(l.block.lines.map((q) => q.text).join('|'));
    const sp = roomSpans(mask, bm.nx, bm.ny, [l.centre.x / bm.px, l.centre.y / bm.px], Math.max(1.5, 0.45 * (l.block.size / bm.px)), cap);
    const ok = sp.left !== null && sp.right !== null && sp.up !== null && sp.down !== null && sp.right > sp.left && sp.down > sp.up;
    measures.push({ id: f.id, label: f.label, printed: { w: f.labelDims.w, l: f.labelDims.l }, spanPt: ok ? { w: (sp.right! - sp.left!) * bm.px, h: (sp.down! - sp.up!) * bm.px } : null, boxPt: ok ? [sp.left! * bm.px, sp.up! * bm.px, sp.right! * bm.px, sp.down! * bm.px] : null });
  }
  const ev: Evidence = { dims: [], labels: measures.filter((m) => m.spanPt).map((m) => ({ id: m.id, owner: m.id, wPx: m.spanPt!.w, hPx: m.spanPt!.h, a: m.printed.w, b: m.printed.l })) };
  const fit = ev.labels.length >= 4 ? fitScale(ev, FIT_REL) : null;
  const good = !!fit && fit.ok && fit.spread < 0.08 && fit.inliers >= 0.4 * fit.total;
  const out: LabelGeometry = { fit: good ? fit : null, measures, status: new Map(), notes: new Map(), ptPerM: good ? (fit!.sx + fit!.sy) / 2 : null };
  if (!good) return out;
  for (const m of measures) {
    if (!m.spanPt) continue;
    const loo = looFit(ev, m.id, FIT_REL);
    if (!loo?.ok || loo.spread >= 0.08) continue;
    const o = labelFit({ id: m.id, owner: m.id, wPx: m.spanPt.w, hPx: m.spanPt.h, a: m.printed.w, b: m.printed.l }, loo.sx, loo.sy).best;
    const [mx, my] = o === 0 ? [m.printed.w, m.printed.l] : [m.printed.l, m.printed.w];
    // sizes alone say nothing of where a room is: a right-sized polygon in the wrong place is not verified. The room must sit on the walls measured.
    const room = result.proposal.rooms.find((r) => r.id === m.id);
    const fr = trace.frame!;
    const placed = !!room && !!m.boxPt && (() => {
      const xs = room.polygon.map((p) => p.x * fr.ptPerM + fr.cx), ys = room.polygon.map((p) => p.z * fr.ptPerM + fr.cy);
      const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
      return Math.abs(cx - (m.boxPt![0] + m.boxPt![2]) / 2) <= 0.2 * m.spanPt!.w && Math.abs(cy - (m.boxPt![1] + m.boxPt![3]) / 2) <= 0.2 * m.spanPt!.h;
    })();
    if (agrees(m.spanPt.w, mx, loo, 'x', VERIFY_REL) && agrees(m.spanPt.h, my, loo, 'y', VERIFY_REL)) { if (placed) out.status.set(m.id, 'verified'); }
    else if (clearlyWrong(m.spanPt.w, mx, loo, 'x', CONFLICT_REL) || clearlyWrong(m.spanPt.h, my, loo, 'y', CONFLICT_REL)) {
      out.status.set(m.id, 'conflict');
      out.notes.set(m.id, `label says ${mx.toFixed(2)} x ${my.toFixed(2)} m, the walls drawn around it measure about ${(m.spanPt.w / loo.sx).toFixed(2)} x ${(m.spanPt.h / loo.sy).toFixed(2)} m`);
    }
  }
  return out;
}
