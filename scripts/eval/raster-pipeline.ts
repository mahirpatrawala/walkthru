// C12d: the raster path as a pipeline for the C12a harness. A set's picture is looked up by id (the harness input carries only
// the page size), the path runs with a provider the caller builds, and the answer is reduced to a Prediction.
import { readRasterPages } from '../../src/understand/raster';
import type { RasterRun } from '../../src/understand/raster';
import type { VisionProvider } from '../../src/understand/vision/provider';
import type { Status } from '../../src/understand/types';
import type { Pipeline } from './adapters';
import type { Prediction, PredOpening, Pt } from './types';
import type { RasterTwin } from './raster-world';

const worst = (...s: Status[]): Status => (s.includes('conflict') ? 'conflict' : s.every((x) => x === 'verified') ? 'verified' : 'unverified');

/** Quarter turns of the predicted frame back to the sheet's own frame. A lone rectangular room looks the same turned any way, so
 *  the scorer cannot tell which way is up; a person looking at the page can. `eCcw` is how far the picture is turned
 *  counter-clockwise from the upright design frame once the pipeline's own turn is taken off. */
export function uprightPoint(p: Pt, eCcw: number): Pt {
  switch (((eCcw % 360) + 360) % 360) { case 90: return [-p[1], p[0]]; case 180: return [-p[0], -p[1]]; case 270: return [p[1], -p[0]]; default: return p; }
}
export function predictionOf(run: RasterRun, sheetRotationCcw = 0): Prediction {
  const pred = predictionRaw(run);
  if (!pred.attempted) return pred;
  const turn = run.understanding.views.find((v) => v.kind === 'plan')?.turnedCw ?? 0;
  const e = sheetRotationCcw - turn;
  if (((e % 360) + 360) % 360 === 0) return pred;
  const u = (p: Pt): Pt => uprightPoint(p, e);
  return {
    ...pred,
    rooms: pred.rooms?.map((r) => ({ ...r, polygon: r.polygon.map(u) })),
    openings: pred.openings?.map((o) => ({ ...o, at: u(o.at) })),
    items: pred.items?.map((i) => { const c = u([i.box.cx, i.box.cz]); const q = ((e % 180) + 180) % 180 === 90; return { ...i, box: { cx: c[0], cz: c[1], w: q ? i.box.d : i.box.w, d: q ? i.box.w : i.box.d } }; }),
    symbols: pred.symbols?.map((s) => ({ ...s, at: u(s.at) })),
    dimensions: pred.dimensions?.map((d) => ({ ...d, a: u(d.a), b: u(d.b) })),
  };
}
function predictionRaw(run: RasterRun): Prediction {
  if (run.status !== 'ok' || !run.result) return { attempted: false, error: run.reason ?? 'refused', seconds: run.cost.wallSeconds };
  const u = run.understanding;
  const rooms = u.rooms.map((r) => ({ label: r.label.value, roomType: r.roomType.value, polygon: r.polygonM, status: worst(r.width.status, r.length.status, r.area.status) }));
  const openings: PredOpening[] = run.result.proposal.openings.map((o) => {
    const room = run.result!.proposal.rooms.find((x) => x.id === o.roomId)!;
    const a = room.polygon[o.edge], b = room.polygon[(o.edge + 1) % room.polygon.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { type: o.type, at: [a.x + ((b.x - a.x) / L) * o.centreM, a.z + ((b.z - a.z) / L) * o.centreM] as Pt, widthM: o.widthM, status: 'unverified' as Status };
  });
  return {
    attempted: true, rooms, openings,
    items: u.items.map((i) => ({ cls: i.kind.value, box: { cx: i.box.cx, cz: i.box.cz, w: i.box.w.value, d: i.box.d.value }, status: worst(i.box.w.status, i.box.d.status) })),
    symbols: u.symbols.map((s) => ({ cls: s.class.value, at: s.centreM, status: s.class.status })),
    dimensions: u.dimensions.map((d) => ({ string: d.value.source.text ?? '', a: d.a, b: d.b, view: 'plan' as const, status: d.value.status })),
    seconds: run.cost.wallSeconds,
  };
}

export interface RasterPipelineOpts { provider: (t: RasterTwin) => VisionProvider | null; onRun?: (id: string, run: RasterRun) => void }
export function rasterPipeline(twins: Map<string, RasterTwin>, o: RasterPipelineOpts): Pipeline {
  return async (input) => {
    if (input.kind !== 'raster') return { attempted: false, error: 'not a picture' };
    const twin = twins.get(input.id);
    if (!twin) return { attempted: false, error: 'no picture for this set' };
    const run = await readRasterPages(twin.pages, { provider: o.provider(twin) });
    o.onRun?.(input.id, run);
    return predictionOf(run, twin.truth.options.rotation);
  };
}
