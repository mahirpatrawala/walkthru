// C12d: the raster twin of a synthetic set, and what a simulated vision model is told about it (src/understand/vision/mock.ts).
// A MockWorld is truth projected into the pixels of the rasterised page, through the same maps the generator used (page frame,
// sheet rotation, dpi, and the phone-photo warp), so it follows the picture however the pipeline later crops or straightens it.
import type { BuiltSet } from '../make-drawing-sets';
import { rasterPagesOf } from '../make-drawing-sets';
import { phoneForward } from '../drawing-sets/raster';
import type { Gray } from '../../src/understand/pixels/image';
import { applyMat } from '../../src/understand/pixels/image';
import type { MockPageWorld, MockWorld } from '../../src/understand/vision/mock';
import type { TruthLite } from './types';
import type { SetTruth } from '../drawing-sets/types';

type Pt = [number, number];
type Rect = [number, number, number, number];

export interface RasterTwin { id: string; truth: SetTruth; pages: { id: string; image: Gray }[]; world: MockWorld }

/** Truth the raster column of SPEC 17.11 asks about: the plan. Elevation pictures are not read, so their fields are not scored. */
export function planOnlyTruth(t: SetTruth): TruthLite {
  const lite = t as unknown as TruthLite;
  return { rooms: lite.rooms, openings: lite.openings, items: lite.items, symbols: lite.symbols, dimensions: (lite.dimensions ?? []).filter((d) => d.view === 'plan'), elevations: [] };
}

export function buildTwin(b: BuiltSet): RasterTwin {
  const t = b.truth;
  const images = rasterPagesOf(b);
  const g0 = images[0];
  const rot = t.options.rotation;
  const rotated = rot === 90 || rot === 270;
  const Wd = rotated ? t.page.heightPt : t.page.widthPt, Hd = rotated ? t.page.widthPt : t.page.heightPt;
  const user = (x: number, y: number): Pt => (rot === 0 ? [x, Hd - y] : rot === 90 ? [y, x] : rot === 180 ? [Wd - x, y] : [Hd - y, Wd - x]);
  const k = t.options.raster.dpi / 72;
  const H = t.options.raster.phone ? phoneForward(g0.width, g0.height, t.options.raster.warpDeg, t.seed * 31) : null;
  const pf = t.planFrame;
  const px = (X: number, Z: number): Pt => {
    const u = user(pf.ox + X * pf.S, pf.oy + Z * pf.S * pf.stretch);
    const p: Pt = [u[0] * k, g0.height - u[1] * k];
    return H ? applyMat(H, p) : p;
  };
  const rectOf = (pts: Pt[]): Rect => [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1])), Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  const polyM = (x0: number, z0: number, x1: number, z1: number): Pt[] => [px(x0, z0), px(x1, z0), px(x1, z1), px(x0, z1)];

  const rooms = t.rooms.map((r) => ({ label: r.labelString ?? '', sizeText: r.dimsString ?? '', areaText: r.areaString ?? '', polyPx: r.polygonM.map(([x, z]) => px(x, z)) }));
  const dims = t.dimensions.filter((d) => d.view === 'plan').map((d) => ({ text: d.string, aPx: px(d.a[0], d.a[1]), bPx: px(d.b[0], d.b[1]) }));
  const openings = t.openings.map((o) => {
    const w = o.widthM, thick = o.type === 'window' ? 0.2 : w;
    const alongX = o.axis === 'x';
    return { kind: o.type, polyPx: polyM(o.at.x - (alongX ? w : thick) / 2, o.at.z - (alongX ? thick : w) / 2, o.at.x + (alongX ? w : thick) / 2, o.at.z + (alongX ? thick : w) / 2) };
  });
  const symbols = t.symbols.map((s) => {
    const item = s.itemId ? t.items.find((i) => i.id === s.itemId) : undefined;
    // a model boxes "the sofa": the item's own box where truth has one (the drawn symbol can carry arms or a swing beyond it)
    const b = item ? ((): [number, number, number, number] => { const q = Math.abs(Math.round(item.box.yawDeg / 90)) % 2 === 1; const hw = (q ? item.box.d : item.box.w) / 2, hd = (q ? item.box.w : item.box.d) / 2; return [item.box.cx - hw, item.box.cz - hd, item.box.cx + hw, item.box.cz + hd]; })() : s.bboxM;
    return { cls: s.cls as string, label: s.labelled ? item?.labelString ?? undefined : undefined, polyPx: polyM(b[0], b[1], b[2], b[3]) };
  });
  const everything = [...rooms.flatMap((r) => r.polyPx), ...dims.flatMap((d) => [d.aPx, d.bPx]), ...symbols.flatMap((s) => s.polyPx)];
  const planRect = rectOf(everything);
  const area = (r: Rect): number => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
  const textBlocks = t.textBlocksPt.map(([x0, y0, x1, y1]) => {
    const c = [user(x0, y0), user(x1, y0), user(x1, y1), user(x0, y1)].map((u): Pt => { const p: Pt = [u[0] * k, g0.height - u[1] * k]; return H ? applyMat(H, p) : p; });
    return rectOf(c);
  });
  const page0: MockPageWorld = {
    rooms, dims, openings, symbols, textBlocks,
    classify: (rect) => {
      const ix = Math.max(0, Math.min(rect[2], planRect[2]) - Math.max(rect[0], planRect[0])) * Math.max(0, Math.min(rect[3], planRect[3]) - Math.max(rect[1], planRect[1]));
      if (ix >= 0.5 * Math.min(area(rect), area(planRect))) return 'plan';
      return t.options.elevations > 0 ? 'elevation' : 'notes';
    },
  };
  const world: MockWorld = {};
  const pages = images.map((image, i) => {
    const id = `p${i + 1}`;
    world[id] = i === 0 ? page0 : { rooms: [], dims: [], openings: [], symbols: [], textBlocks: [], classify: () => 'elevation' };
    return { id, image };
  });
  return { id: t.id, truth: t, pages, world };
}
