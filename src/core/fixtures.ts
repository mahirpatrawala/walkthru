// Sanitary and kitchen fixtures the drawing reader recognised (SPEC 17.7: WC, basin, shower, sink), drawn in the walk-through at the drawn
// position. A fixture becomes a `real` furniture item of the catalogue piece that matches it: its box takes the symbol's size when that is
// a believable size for the piece, otherwise the catalogue's standard size, and the card says which (SPEC 16.2: a number is never shown as
// drawn when it was assumed). Heights are always the catalogue's standard. Pure.
import { distanceToSegment, pointInPolygon } from './geometry';
import { catalogItem } from './catalog';
import type { FurnitureItem, Layout, Vec2 } from '../types';

export type FixtureClass = 'wc' | 'basin' | 'shower' | 'sink' | 'hob';

/** One recognised symbol with its place on the plan, world metres, as `proposal-extras.json` carries it. */
export interface SceneFixture {
  id: string;
  cls: FixtureClass;
  at: Vec2;
  /** the symbol's own outline, when the reader measured it (long and short side in either order) */
  sizeM?: { w: number; d: number };
  /** which way its front faces, when known; otherwise it faces into its room, back to the nearest wall */
  yawDeg?: number;
}

/** The catalogue piece each recognised class is drawn as. A hob has none yet (a gas hob is not in the catalogue). */
export const FIXTURE_PIECE: Partial<Record<FixtureClass, string>> = {
  wc: 'wc-western', basin: 'basin-wall', shower: 'shower-enclosure', sink: 'sink-single',
};
/** a believable symbol is within this range of the standard size on its long and its short side */
const SIZE_RANGE: [number, number] = [0.6, 1.6];

const sizeSource = new Map<string, 'drawing' | 'standard'>();
/** The sentence for a fixture's card: where its width and depth came from. Null for a piece that is not a drawn fixture. */
export function fixtureSizeNote(id: string): string | null {
  const s = sizeSource.get(id);
  if (!s) return null;
  return s === 'drawing' ? "Width and depth are from the drawing's symbol. Height is a standard assumption." : 'Standard size, not on the drawing. Height is a standard assumption.';
}
export function clearFixtureSources(): void { sizeSource.clear(); }

/** Yaw (degrees) that faces `at` into its room with its back to the nearest wall, or 0 when no room holds it. */
export function facingYawDeg(layout: Layout, at: Vec2): number {
  let best: { d: number; nx: number; nz: number } | null = null;
  for (const room of layout.rooms) {
    const poly = room.polygon;
    if (!pointInPolygon(at, poly)) continue;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const d = distanceToSegment(at, p, q);
      if (best && d >= best.d) continue;
      const dx = q.x - p.x, dz = q.z - p.z, len = Math.hypot(dx, dz) || 1;
      let nx = dz / len, nz = -dx / len;
      const mid = { x: (p.x + q.x) / 2 + nx * 0.15, z: (p.z + q.z) / 2 + nz * 0.15 };
      if (!pointInPolygon(mid, poly)) { nx = -nx; nz = -nz; }
      best = { d, nx, nz };
    }
  }
  if (!best) return 0;
  return ((Math.atan2(best.nx, best.nz) * 180) / Math.PI + 360) % 360;
}

/** The catalogue piece for a fixture: a sink wider than 115 cm is the double bowl. */
export function fixturePieceId(f: SceneFixture): string | null {
  const base = FIXTURE_PIECE[f.cls];
  if (!base) return null;
  if (f.cls === 'sink' && f.sizeM && Math.max(f.sizeM.w, f.sizeM.d) >= 1.15) return 'sink-double';
  return base;
}

/** Real furniture items for the fixtures the catalogue can draw. Ids are `fx-<fixture id>`, so the same drawing gives the same items. */
export function fixturesToItems(fixtures: readonly SceneFixture[], layout: Layout): FurnitureItem[] {
  const out: FurnitureItem[] = [];
  for (const f of fixtures) {
    const pieceId = fixturePieceId(f);
    if (!pieceId || !f.at || !Number.isFinite(f.at.x) || !Number.isFinite(f.at.z)) continue;
    const spec = catalogItem(pieceId);
    let w = spec.footprint.w, d = spec.footprint.d;
    let source: 'drawing' | 'standard' = 'standard';
    if (f.sizeM && f.sizeM.w > 0 && f.sizeM.d > 0) {
      const long = Math.max(f.sizeM.w, f.sizeM.d), short = Math.min(f.sizeM.w, f.sizeM.d);
      const pw = spec.footprint.w >= spec.footprint.d;
      const L = Math.max(spec.footprint.w, spec.footprint.d), S = Math.min(spec.footprint.w, spec.footprint.d);
      const ok = (v: number, std: number): boolean => v >= std * SIZE_RANGE[0] && v <= std * SIZE_RANGE[1];
      if (ok(long, L) && ok(short, S)) {
        w = pw ? long : short; d = pw ? short : long;
        source = 'drawing';
      }
    }
    const id = `fx-${f.id}`;
    sizeSource.set(id, source);
    out.push({
      id, source: 'real', kind: spec.kind, catalogId: pieceId, label: spec.name,
      box: { cx: f.at.x, cz: f.at.z, w: Math.round(w * 1000) / 1000, d: Math.round(d * 1000) / 1000, yawDeg: f.yawDeg ?? facingYawDeg(layout, f.at) },
      heightM: spec.heightM, surfaceHeightM: spec.surfaceHeightM,
    });
  }
  return out;
}
