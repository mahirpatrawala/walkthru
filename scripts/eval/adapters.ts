// C12a: pipelines under test, each reduced to a Prediction. `c8` is the importer of SPEC 13 as it stands.
import { proposeFromPages, proposeWithTrace } from '../../src/import/propose';
import { ImportError } from '../../src/import/types';
import type { VectorPage } from '../../src/import/types';
import { furnitureOf } from '../../src/understand/lexicon';
import type { Prediction, PredDim, PredElevation, PredItem, PredOpening, PredSymbol, Pt } from './types';
import type { Status } from '../../src/understand/types';
import { analyseTrace } from '../../src/understand/text-dims';
import { understandPages } from '../../src/understand/pipeline';
import type { Understood } from '../../src/understand/pipeline';

export type PipelineInput =
  | { kind: 'vector'; id: string; pages: VectorPage[] }
  | { kind: 'raster'; id: string; pageCount: number; width: number; height: number };
export type Pipeline = (input: PipelineInput) => Prediction | Promise<Prediction>;

const CLS: Record<string, string> = { study: 'desk', dressing: 'wardrobe', desk: 'desk', 'side table': 'side table' };
const clsOfLabel = (label: string, kind: string): string => {
  const f = furnitureOf(label);
  const k = f?.entry.key ?? kind;
  return CLS[k] ?? k;
};

/** The C8 importer. It assigns no statuses, so every value is `unverified`; it cannot read dimension strings, symbols without
 *  labels, elevation content or raster input, and those fields are left undefined (not attempted). */
export const c8Pipeline: Pipeline = (input) => {
  const t0 = Date.now();
  let pages: VectorPage[];
  if (input.kind === 'raster') {
    // what pdf.js gives for a scanned PDF or an image: one picture covering the page and no paths
    pages = Array.from({ length: input.pageCount }, (_, i) => ({ index: i, width: input.width, height: input.height, fills: [], strokes: [], texts: [], imageCoverage: 1 }));
  } else pages = input.pages;
  try {
    // C12b: the importer as it stood before it read stroke text or dimension lines, so the C8 column stays the C8 baseline
    const r = proposeFromPages(pages, 'input', 'eval', { understandText: false });
    const rooms = r.proposal.rooms.map((x) => ({ label: x.label ?? '', roomType: x.roomType, polygon: x.polygon.map((p): Pt => [p.x, p.z]), status: 'unverified' as const }));
    const openings: PredOpening[] = r.proposal.openings.map((o) => {
      const room = r.proposal.rooms.find((x) => x.id === o.roomId)!;
      const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { type: o.type, at: [a.x + ((b.x - a.x) / L) * o.centreM, a.z + ((b.z - a.z) / L) * o.centreM], widthM: o.widthM, status: 'unverified' };
    });
    const items: PredItem[] = r.extras.furniture.map((f) => ({ cls: clsOfLabel(f.label ?? '', f.kind), box: { cx: f.box.cx, cz: f.box.cz, w: f.box.w, d: f.box.d }, status: 'unverified' }));
    const pred: Prediction = { attempted: true, rooms, openings, items, seconds: (Date.now() - t0) / 1000 };
    if (r.extras.ceiling.method !== 'default') pred.ceiling = { v: r.extras.ceiling.heightM, status: 'unverified' };
    return pred;
  } catch (e) {
    return { attempted: false, error: e instanceof ImportError ? `${e.code}: ${e.message}` : `error: ${(e as Error).message}`, seconds: (Date.now() - t0) / 1000 };
  }
};

/** Truth reflected back: the best any pipeline could do. Used to test the harness itself. */
export function oraclePipeline(truthOf: (id: string) => import('./types').TruthLite & { options?: unknown }): Pipeline {
  return (input) => {
    const t = truthOf(input.id);
    return {
      attempted: true,
      rooms: (t.rooms ?? []).map((r) => ({ label: r.id, roomType: r.roomType, polygon: r.polygonM, status: 'verified' as const })),
      openings: (t.openings ?? []).map((o) => ({ type: o.type, at: [o.at.x, o.at.z] as Pt, widthM: o.widthM, status: 'verified' as const })),
      items: (t.items ?? []).map((i) => ({ cls: i.cls, box: i.box, status: 'verified' as const })),
      symbols: (t.symbols ?? []).map((s) => ({ cls: s.cls, at: [(s.bboxM[0] + s.bboxM[2]) / 2, (s.bboxM[1] + s.bboxM[3]) / 2] as Pt, status: 'verified' as const })),
      dimensions: (t.dimensions ?? []).map((d) => ({
        string: d.string, a: d.a, b: d.b, view: (d.view === 'plan' ? 'plan' : 'elevation') as 'plan' | 'elevation',
        status: d.planted || Math.abs(d.shownM - d.valueM) > Math.max(0.02 * d.valueM, 0.0254) ? ('conflict' as const) : ('verified' as const),
      })),
      ceiling: undefined,
      elevations: (t.elevations ?? []).map((e) => ({
        caption: e.caption,
        wall: e.wall ? { at: wallMid(t, e.wall) } : undefined,
        heights: [{ kind: 'ceiling', v: e.ceilingM, status: 'verified' as const }, ...e.levels.filter((l) => l.kind === 'sill' || l.kind === 'head').map((l) => ({ kind: l.kind, v: l.heightM, status: 'verified' as const })),
          ...(e.bed ? [{ kind: 'bed-base', v: e.bed.baseTopM, status: 'verified' as const }, { kind: 'mattress-top', v: e.bed.mattressTopM, status: 'verified' as const }, { kind: 'headboard-top', v: e.bed.headboardTopM, status: 'verified' as const }] : [])],
        units: e.units.map((u) => ({ bays: u.bays, shuttersPerBay: u.shuttersPerBay, hinge: u.hinge, status: 'verified' as const, drawerStripM: u.drawerStripM, loftM: u.loftM, baseGapM: u.baseGapM, heightM: u.heightM })),
      })),
    };
  };
}
function wallMid(t: import('./types').TruthLite, w: { roomId: string; edge: number }): Pt {
  const r = t.rooms!.find((x) => x.id === w.roomId)!;
  const p = r.polygonM, e = w.edge;
  return [(p[e][0] + p[(e + 1) % p.length][0]) / 2, (p[e][1] + p[(e + 1) % p.length][1]) / 2];
}

/**
 * C12b: the C8 importer with stroke text read, plus dimension strings found, fitted against a scale and given honest statuses
 * (SPEC 17.5). Rooms are verified only through label checks against the dimension-fitted scale.
 */
export const c12bPipeline: Pipeline = (input) => {
  const t0 = Date.now();
  let pages: VectorPage[];
  if (input.kind === 'raster') {
    pages = Array.from({ length: input.pageCount }, (_, i) => ({ index: i, width: input.width, height: input.height, fills: [], strokes: [], texts: [], imageCoverage: 1 }));
  } else pages = input.pages;
  try {
    const { result: r, trace } = proposeWithTrace(pages, 'input', 'eval');
    const an = analyseTrace(r, trace);
    const rooms = r.proposal.rooms.map((x) => ({ label: x.label ?? '', roomType: x.roomType, polygon: x.polygon.map((p): Pt => [p.x, p.z]), status: an.roomStatus.get(x.id) ?? ('unverified' as const) }));
    const openings: PredOpening[] = r.proposal.openings.map((o) => {
      const room = r.proposal.rooms.find((x) => x.id === o.roomId)!;
      const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
      const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      return { type: o.type, at: [a.x + ((b.x - a.x) / L) * o.centreM, a.z + ((b.z - a.z) / L) * o.centreM], widthM: o.widthM, status: 'unverified' };
    });
    const items: PredItem[] = r.extras.furniture.map((f) => ({ cls: clsOfLabel(f.label ?? '', f.kind), box: { cx: f.box.cx, cz: f.box.cz, w: f.box.w, d: f.box.d }, status: 'unverified' }));
    const dimensions: PredDim[] = an.dims.map((d) => ({ string: d.string, a: d.a, b: d.b, view: d.role, status: d.status }));
    const pred: Prediction = { attempted: true, rooms, openings, items, dimensions, seconds: (Date.now() - t0) / 1000 };
    if (r.extras.ceiling.method !== 'default') pred.ceiling = { v: r.extras.ceiling.heightM, status: 'unverified' };
    return pred;
  } catch (e) {
    return { attempted: false, error: e instanceof ImportError ? `${e.code}: ${e.message}` : `error: ${(e as Error).message}`, seconds: (Date.now() - t0) / 1000 };
  }
};

/**
 * C12c: the whole vector pipeline (any wall style, rooms without labels, symbols, elevations). Statuses come from the C12b analysis
 * for rooms and dimensions; plan symbols and everything measured from geometry alone are `unverified`.
 */
export const c12cPipeline: Pipeline = (input) => {
  const t0 = Date.now();
  let pages: VectorPage[];
  if (input.kind === 'raster') pages = Array.from({ length: input.pageCount }, (_, i) => ({ index: i, width: input.width, height: input.height, fills: [], strokes: [], texts: [], imageCoverage: 1 }));
  else pages = input.pages;
  try {
    const u: Understood = understandPages(pages, 'input', 'eval');
    return predictionOf(u, (Date.now() - t0) / 1000);
  } catch (e) {
    return { attempted: false, error: e instanceof ImportError ? `${e.code}: ${e.message}` : `error: ${(e as Error).message}`, seconds: (Date.now() - t0) / 1000 };
  }
};

export function predictionOf(u: Understood, seconds: number): Prediction {
  const { result: r, analysis: an, plan } = u;
  const unnamed = (label: string): boolean => /^room( \d+)?$/i.test(label.trim());
  const rooms = r.proposal.rooms.map((x) => ({
    label: x.label ?? '', roomType: (unnamed(x.label ?? '') && x.roomType === 'other' ? plan.roomTypes.get(x.id) : undefined) ?? x.roomType,
    polygon: x.polygon.map((p): Pt => [p.x, p.z]), status: an.roomStatus.get(x.id) ?? ('unverified' as const),
  }));
  const openings: PredOpening[] = r.proposal.openings.map((o) => {
    const room = r.proposal.rooms.find((x) => x.id === o.roomId)!;
    const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { type: o.type, at: [a.x + ((b.x - a.x) / L) * o.centreM, a.z + ((b.z - a.z) / L) * o.centreM], widthM: o.widthM, status: 'unverified' };
  });
  const items: PredItem[] = r.extras.furniture.map((f) => ({ cls: clsOfLabel(f.label ?? '', f.kind), box: { cx: f.box.cx, cz: f.box.cz, w: f.box.w, d: f.box.d }, status: 'unverified' }));
  for (const s of plan.symbols) {
    if (!s.furniture) continue;
    if (items.some((i) => i.cls === s.cls && Math.hypot(i.box.cx - s.box.cx, i.box.cz - s.box.cz) < 0.6)) continue;
    items.push({ cls: s.cls, box: { cx: s.box.cx, cz: s.box.cz, w: s.box.w, d: s.box.d }, status: 'unverified' });
  }
  const symbols: PredSymbol[] = plan.symbols.map((s) => ({ cls: s.cls, at: [(s.bboxM[0] + s.bboxM[2]) / 2, (s.bboxM[1] + s.bboxM[3]) / 2] as Pt, status: 'unverified' as const }));
  const dimensions: PredDim[] = an.dims.map((d) => ({ string: d.string, a: d.a, b: d.b, view: d.role, status: d.status }));
  const pred: Prediction = { attempted: true, rooms, openings, items, symbols, dimensions, seconds };
  if (r.extras.ceiling.method !== 'default') pred.ceiling = { v: r.extras.ceiling.heightM, status: 'unverified' };
  pred.elevations = elevationsOf(u);
  return pred;
}

const statusOfAll = (...xs: ({ status: Status } | undefined)[]): Status => {
  const s = xs.filter((x): x is { status: Status } => !!x).map((x) => x.status);
  if (s.includes('conflict')) return 'conflict';
  if (s.includes('unverified')) return 'unverified';
  return s.length ? 'verified' : 'unverified';
};

/** The elevation stage's reads as the harness's PredElevation list (one per view with a caption it read). */
export function elevationsOf(u: Understood): PredElevation[] {
  const out: PredElevation[] = [];
  for (const v of u.elev.views) {
    const link = u.elev.links.find((l) => l.view === v.id);
    const rd = u.elev.reads.find((x) => x.view === v.id);
    const pe: PredElevation = { caption: v.caption?.text ?? '', linkConfidence: link?.confidence, page: v.page, top: v.box[1] };
    if (link?.wall) {
      const w = u.elev.walls.find((x) => x.roomId === link.wall!.roomId && x.edge === link.wall!.edge);
      const room = u.result.proposal.rooms.find((r) => r.id === link.wall!.roomId);
      pe.wall = { at: [link.wall.mid.x, link.wall.mid.z] };
      if (w && room) {
        const ux = (w.q.x - w.p.x) / w.length, uz = (w.q.z - w.p.z) / w.length;
        pe.wall.normal = [uz, -ux];
        pe.wall.roomAt = [room.polygon.reduce((a, p) => a + p.x, 0) / room.polygon.length, room.polygon.reduce((a, p) => a + p.z, 0) / room.polygon.length];
      }
    }
    if (rd) {
      const nameOf: Record<string, string> = { ceiling: 'ceiling', sill: 'sill', head: 'head', 'bed-base': 'bed-base', 'mattress-top': 'mattress-top', 'headboard-top': 'headboard-top' };
      pe.heights = rd.levels.filter((l) => nameOf[l.kind]).map((l) => ({ kind: nameOf[l.kind], v: l.e.value, status: l.e.status }));
      pe.units = rd.units.map((un) => ({
        bays: un.design.bays.value,
        shuttersPerBay: un.design.shuttersPerBay.map((e) => e.value),
        hinge: un.design.hinge.map((h) => (h.status === 'conflict' ? 'conflict' : h.value)),
        status: statusOfAll(un.design.bays, ...un.design.shuttersPerBay),
        drawerStripM: un.design.drawerStrip?.value, loftM: un.design.loft?.value, baseGapM: un.design.baseGap?.value, heightM: un.height?.value,
        hingeStatus: un.design.hinge.map((h) => h.status),
        partStatus: { drawerStripM: un.design.drawerStrip?.status, loftM: un.design.loft?.status, baseGapM: un.design.baseGap?.status, heightM: un.height?.status },
      }));
    }
    out.push(pe);
  }
  return out;
}
