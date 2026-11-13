// Sittable chairs. A drawing's chairs (designs.json `decor`, look 'chair') are interactables of the buyer page without being a
// FurnitureKind: each one is a seat item (a sofa-kind stand-in that never enters the furniture store), blocks the walk grid, and
// carries its own card and pose. Nothing here names a scene; any drawing's decor chairs become seats.
import { chairCheck } from '../core/checks';
import { chairPose } from '../core/poses';
import { CHAIR_SIZE } from '../look/furniture-real';
import { decorPlacement } from '../look/designs';
import type { DecorDesign, DesignSource, DesignsFile } from '../look/designs';
import type { CheckCard, FurnitureItem, SeatPose, Vec2 } from '../types';

export const SEAT_ID_PREFIX = 'seat:';
export const CHAIR_PROMPT = 'Sit on the chair';
/** Standing height used for the walk grid: a chair back, so it blocks like furniture. */
const CHAIR_BLOCK_HEIGHT_M = 0.9;
const VARIANT_NAME = { swivel: 'swivel chair', side: 'side chair' } as const;

export interface Seat {
  item: FurnitureItem;
  seatM: number;
  /** 'drawing' only when designs.json gives a seat height with a source */
  seatSource: 'drawing' | 'standard';
  provenance: string;
}

export interface Seats {
  seats: Seat[];
  /** stand-in items for the interaction layer (never in the furniture store) */
  items(): FurnitureItem[];
  isSeat(item: FurnitureItem): boolean;
  card(item: FurnitureItem, heightM: number): CheckCard | null;
  pose(item: FurnitureItem, heightM: number): SeatPose | null;
  /** boxes to stamp into the walk grid */
  obstacles(): { box: FurnitureItem['box']; heightM: number }[];
  /** seat height under a point (within `tol` of a chair footprint), else null */
  surfaceAt(p: Vec2, tol?: number): number | null;
}

const cm = (m: number): number => Math.round(m * 100);
function sourceText(s: DesignSource | DesignSource[] | string | undefined): string {
  const one = Array.isArray(s) ? s[0] : s;
  if (!one) return 'the drawing';
  return typeof one === 'string' ? one : `page ${one.page}${one.sheet ? `, sheet ${one.sheet}` : ''}`;
}

export function buildSeats(designs: DesignsFile | null, items: FurnitureItem[]): Seats {
  const seats: Seat[] = [];
  for (const spec of designs?.decor ?? ([] as DecorDesign[])) {
    const host = items.find((i) => i.id === spec.tiedTo);
    if (!host) continue;
    const variant = spec.variant ?? 'swivel';
    const size = CHAIR_SIZE[variant];
    const at = decorPlacement(spec, host);
    const drawn = spec.seatHeightM !== undefined;
    const seatM = spec.seatHeightM ?? size.seatM;
    const name = VARIANT_NAME[variant];
    const label = host.kind === 'counter' && variant === 'swivel' ? 'Study chair' : name[0].toUpperCase() + name.slice(1);
    const provenance = drawn
      ? `Seat height ${cm(seatM)} cm, from the drawing (${sourceText(spec.sources?.seatHeightM)}).`
      : `Seat height ${cm(seatM)} cm (standard ${name}, not from the drawing).`;
    seats.push({
      seatM, seatSource: drawn ? 'drawing' : 'standard', provenance,
      item: {
        id: SEAT_ID_PREFIX + spec.id, source: 'virtual', kind: 'sofa', label,
        box: { cx: at.x, cz: at.z, w: size.w, d: size.d, yawDeg: at.yawDeg },
        heightM: CHAIR_BLOCK_HEIGHT_M, surfaceHeightM: seatM,
      },
    });
  }
  const find = (item: FurnitureItem): Seat | undefined => seats.find((s) => s.item.id === item.id);
  return {
    seats,
    items: () => seats.map((s) => s.item),
    isSeat: (item) => !!find(item),
    card(item, H) {
      const s = find(item);
      return s ? chairCheck(s.item.box.w, s.item.box.d, s.seatM, H, s.item.label, s.provenance) : null;
    },
    pose(item, H) {
      const s = find(item);
      return s ? chairPose(s.item.box, s.seatM, H) : null;
    },
    obstacles: () => seats.map((s) => ({ box: s.item.box, heightM: s.item.heightM })),
    surfaceAt(p, tol = 0.25) {
      for (const s of seats) {
        if (Math.hypot(p.x - s.item.box.cx, p.z - s.item.box.cz) <= Math.max(s.item.box.w, s.item.box.d) / 2 + tol) return s.seatM;
      }
      return null;
    },
  };
}
