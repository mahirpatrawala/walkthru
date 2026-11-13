// C12e. The vector path as one call, written through a thin adapter because the C12c writers (elevations, symbols, reconcile,
// write.ts) are not there yet. From vector pages it runs C8's importer and C12b's text-and-dimensions stage and turns what they
// found into an understanding file (SPEC 17.6) with honest statuses, plus the machine outputs before any broker review.
//
//   verified    a room whose label size agrees with the dimension-fitted scale, a dimension string that passes C12b's checks
//   conflict    a dimension string or label that disagrees with the drawing, both numbers kept
//   unverified  everything measured from the walls, symbols and furniture boxes, and the wall height
//
// Pure TypeScript (no pdf.js, no files). When C12c lands, its elevation and symbol readers add `unit`, `height` and `elevations` to
// the same file and nothing downstream (review rows, writer) changes. Every id is a hash of the field path and the source box.
import { createHash } from 'node:crypto';
import { boxCorners } from '../core/geometry';
import type { Vec2 } from '../types';
import type { ProposalExtras, RoomFinding, VectorPage } from '../import/types';
import { isUnnamedRoom, understandPages } from './pipeline';
import { addElevationData } from './write';
import type { Check, Extracted, Method, Status } from './types';
import type { UnderstandingDoc } from './review-model';
import { fmtFtIn } from './review-model';
import type { BaseOutputs } from './review-apply';

export type { BaseOutputs };
export interface VectorRun {
  doc: UnderstandingDoc;
  base: BaseOutputs;
  /** per page: the raw size in points and the turn the importer applied, for putting boxes back on the page render */
  pages: { index: number; kind: string; width: number; height: number; phi: number }[];
}
export const GENERIC_SOURCE = (pages: number): string => `Imported drawing set, ${pages} page${pages === 1 ? '' : 's'}`;

const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);
type Box4 = [number, number, number, number];
const R = (v: number): number => Math.round(v * 10) / 10;
const bboxOf = (pts: [number, number][]): Box4 => [R(Math.min(...pts.map((p) => p[0]))), R(Math.min(...pts.map((p) => p[1]))), R(Math.max(...pts.map((p) => p[0]))), R(Math.max(...pts.map((p) => p[1])))];
const CONF = { verifiedText: 0.99, verifiedRead: 0.95, twoMethods: 0.6, oneMethod: 0.4, geometry: 0.3, guess: 0.1 };

export function understandVector(pagesIn: VectorPage[], opts: { sceneId: string; sha256: string }): VectorRun {
  const u = understandPages(pagesIn, 'drawing set', opts.sceneId);
  const { result, trace, analysis: an } = u;
  const { proposal } = result;
  const extras: ProposalExtras = { ...result.extras, sourceFile: 'drawing set' };
  const planPage = trace.planIdx + 1;
  const planView = `p${planPage}`;
  const frame = trace.frame;
  const toPage = (w: Vec2): [number, number] => (frame ? [w.x * frame.ptPerM + frame.cx, w.z * frame.ptPerM + frame.cy] : [0, 0]);
  const worldBox = (pts: Vec2[], padM = 0): Box4 => (frame ? bboxOf(pts.flatMap((p) => [toPage({ x: p.x - padM, z: p.z - padM }), toPage({ x: p.x + padM, z: p.z + padM })])) : [0, 0, 0, 0]);
  const ex = <T,>(path: string, value: T, method: Method, status: Status, confidence: number, bbox: Box4, extra: Partial<Extracted<T>> & { text?: string; page?: number } = {}): Extracted<T> => {
    const { text, page, ...rest } = extra;
    return { id: hash(`${path}|${bbox.map((x) => Math.round(x)).join(',')}`), value, method, status, confidence, source: { page: page ?? planPage, view: `p${page ?? planPage}`, sheet: '', bbox, ...(text ? { text } : {}) }, checks: [], ...rest };
  };

  // ---- views
  const views: UnderstandingDoc['views'] = trace.pages.map((p, i) => ({ id: `p${i + 1}`, page: i + 1, kind: trace.kinds[i], kindConfidence: trace.kinds[i] === 'other' ? 0.4 : 0.8, raster: trace.kinds[i] === 'raster' }));
  if (trace.planFit && frame) {
    const v = views[trace.planIdx];
    const good = trace.planFit.inliers.length >= 3 && !trace.planFit.notToScale;
    v.scale = ex('scale', frame.ptPerM, 'derived', good ? 'verified' : 'unverified', good ? CONF.verifiedRead : CONF.geometry, [0, 0, 0, 0], { derivedFrom: { ids: [], how: `page units per metre, fitted from ${trace.planFit.inliers.length} printed dimensions` } });
  }

  // ---- dimensions
  const dimensions: UnderstandingDoc['dimensions'] = [];
  const conflicts: UnderstandingDoc['conflicts'] = [];
  for (const d of an.dims) {
    const v = d.verdict;
    const parts = v.dim.run.parts.length ? v.dim.run.parts : [v.dim.run.read];
    const bbox = bboxOf(parts.flatMap((r) => [[r.bbox[0], r.bbox[1]], [r.bbox[2], r.bbox[3]]] as [number, number][]));
    const text = d.string;
    const conf = d.status === 'verified' ? (v.method === 'pdf-text' ? CONF.verifiedText : CONF.verifiedRead) : d.status === 'conflict' ? CONF.twoMethods : CONF.oneMethod;
    const e = ex(`dimension.${d.page}`, v.valueM, v.method, d.status, conf, bbox, {
      unit: 'm', text, page: d.page + 1, checks: v.checks as Check[],
      ...(d.status === 'conflict' && v.measuredM ? { alternatives: [{ value: v.measuredM, method: 'vector' as Method, source: { page: d.page + 1, view: `p${d.page + 1}`, sheet: '', bbox } }] } : {}),
    });
    dimensions.push({ id: v.dim.id, view: `p${d.page + 1}`, a: d.a, b: d.b, value: e, ...(v.dim.chain ? { chain: v.dim.chain } : {}) });
    if (d.status === 'conflict') conflicts.push({ id: hash(`conflict.${e.id}`), field: `dimensions.${v.dim.id}`, values: [text, v.measuredM ? fmtFtIn(v.measuredM) : ''], message: v.measuredM ? `The drawing says ${text}, but it measures ${fmtFtIn(v.measuredM)}.` : (v.message ?? `${text} disagrees with the drawing.`) });
  }

  // ---- rooms
  const rooms: UnderstandingDoc['rooms'] = [];
  const findingOf = new Map<string, RoomFinding & { verified?: boolean }>(extras.rooms.map((f) => [f.id, f as RoomFinding & { verified?: boolean }]));
  for (const room of proposal.rooms) {
    const f = findingOf.get(room.id);
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...zs) - Math.min(...zs);
    const [w, l] = bw <= bh ? [bw, bh] : [bh, bw];
    const area = f?.areaM2 ?? bw * bh;
    const box = worldBox(room.polygon);
    const roomStatus: Status = an.roomStatus.get(room.id) ?? 'unverified';
    const labelOnly = f?.method === 'label-rect';
    const status: Status = roomStatus;
    const label = f?.labelDims;
    const labelText = label ? `${fmtFtIn(Math.min(label.w, label.l))} x ${fmtFtIn(Math.max(label.w, label.l))}` : undefined;
    const method: Method = status === 'verified' || labelOnly ? 'pdf-text' : 'vector';
    const conf = status === 'verified' ? CONF.verifiedText : status === 'conflict' ? CONF.twoMethods : labelOnly ? CONF.oneMethod : f?.verified === false ? 0.2 : CONF.geometry;
    const checks: Check[] = label && !labelOnly ? [{ kind: 'label-area', expected: label.w * label.l, got: bw * bh, ok: status === 'verified' }] : [];
    const labelAlt = (n: 'width' | 'length'): Extracted<number>['alternatives'] => (status === 'conflict' && label
      ? [{ value: n === 'width' ? Math.min(label.w, label.l) : Math.max(label.w, label.l), method: 'pdf-text' as Method, source: { page: planPage, view: planView, sheet: '', bbox: box, text: labelText } }] : undefined);
    const size = (n: 'width' | 'length' | 'area', v: number): Extracted<number> => {
      const alternatives = n === 'area' ? undefined : labelAlt(n);
      return ex(`room.${n}.${room.id}`, v, method, status, conf, box, { unit: n === 'area' ? 'm2' : 'm', checks, ...(labelText ? { text: labelText } : {}), ...(alternatives ? { alternatives } : {}) });
    };
    const labelEx = ex(`room.label.${room.id}`, room.label ?? room.id, 'pdf-text', 'unverified', CONF.oneMethod, box);
    const typeEx = ex(`room.type.${room.id}`, room.roomType, 'derived', 'unverified', CONF.oneMethod, box, { derivedFrom: { ids: [labelEx.id], how: isUnnamedRoom(room.label ?? '') ? 'the furniture and fixtures drawn in it' : 'room words in the label' } });
    rooms.push({ id: room.id, label: labelEx, roomType: typeEx, polygonM: room.polygon.map((p): [number, number] => [p.x, p.z]), width: size('width', w), length: size('length', l), area: size('area', area) });
    if (status === 'conflict') conflicts.push({ id: hash(`conflict.room.${room.id}`), field: `rooms.${room.id}.size`, values: [labelText ?? '', `${fmtFtIn(w)} x ${fmtFtIn(l)}`], message: `The label says ${labelText ?? 'a different size'}, but the walls measure ${fmtFtIn(w)} x ${fmtFtIn(l)}.` });
  }

  // ---- openings
  const openings: UnderstandingDoc['openings'] = [];
  for (const o of proposal.openings) {
    const room = proposal.rooms.find((r) => r.id === o.roomId);
    if (!room) continue;
    const p = room.polygon[o.edge], q = room.polygon[(o.edge + 1) % room.polygon.length];
    const L = Math.hypot(q.x - p.x, q.z - p.z) || 1;
    const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
    const at = (t: number): Vec2 => ({ x: p.x + e.x * t, z: p.z + e.z * t });
    const box = worldBox([at(o.centreM - o.widthM / 2), at(o.centreM + o.widthM / 2)], 0.12);
    openings.push({
      id: o.id, roomId: o.roomId,
      type: ex(`opening.type.${o.id}`, o.type, 'vector', 'unverified', CONF.geometry, box),
      width: ex(`opening.width.${o.id}`, o.widthM, 'vector', 'unverified', CONF.geometry, box, { unit: 'm' }),
    });
  }

  // ---- furniture on the plan
  const items: UnderstandingDoc['items'] = [];
  for (const f of extras.furniture) {
    const corners = boxCorners(f.box).map((c): Vec2 => c);
    const box = worldBox(corners);
    const text = f.label || undefined;
    items.push({
      id: f.id,
      kind: ex(`item.kind.${f.id}`, f.kind, 'vector', 'unverified', CONF.oneMethod, box, text ? { text } : {}),
      ...(f.label ? { label: ex(`item.label.${f.id}`, f.label, 'pdf-text', 'unverified', CONF.oneMethod, box) } : {}),
      box: { cx: f.box.cx, cz: f.box.cz, w: ex(`item.w.${f.id}`, f.box.w, 'vector', 'unverified', CONF.geometry, box, { unit: 'm' }), d: ex(`item.d.${f.id}`, f.box.d, 'vector', 'unverified', CONF.geometry, box, { unit: 'm' }), yawDeg: f.box.yawDeg },
    });
  }

  // ---- the wall height: one number, located on an elevation page when the importer found it in text
  const c = extras.ceiling;
  const ceilingPage = c.page !== null && c.page !== undefined ? c.page + 1 : planPage;
  const ceiling = ex('ceiling', proposal.wallHeightM ?? c.heightM, c.method === 'text' ? 'pdf-text' : c.method === 'geometry' ? 'vector' : 'derived', 'unverified',
    c.method === 'text' ? CONF.oneMethod : c.method === 'geometry' ? CONF.geometry : CONF.guess, [0, 0, 0, 0],
    { unit: 'm', page: ceilingPage, ...(c.method === 'default' ? { derivedFrom: { ids: [], how: 'no ceiling height was found on the drawing, so 2.75 m is assumed' } } : {}) });

  const doc: UnderstandingDoc = {
    version: 1,
    input: { kind: 'vector-pdf', pages: pagesIn.length, sha256: opts.sha256 },
    views, dimensions, rooms, openings, items, symbols: [], ceiling, conflicts,
    warnings: [...extras.warnings, ...an.warnings],
  };
  const base: BaseOutputs = { proposal, extras, designs: { version: 1, source: GENERIC_SOURCE(pagesIn.length), items: {} } };
  addElevationData(u, doc, base, ex, planPage);
  return {
    doc,
    base,
    pages: trace.pages.map((p, i) => ({ index: i, kind: trace.kinds[i], width: trace.rawPages[i].width, height: trace.rawPages[i].height, phi: -(((p as { rotationDeg?: number }).rotationDeg ?? 0)) })),
  };
}
