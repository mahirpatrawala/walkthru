// Sittable chairs. A drawing's chairs (designs.json `decor`, look 'chair') are interactables of the buyer page without being a
// FurnitureKind: each one is a seat item (a sofa-kind stand-in that never enters the furniture store), blocks the walk grid, and
// carries its own card and pose. Nothing here names a scene; any drawing's decor chairs become seats.
import { chairCheck } from '../core/checks';
import { chairPose } from '../core/poses';
import { CHAIR_SIZE } from '../look/furniture-real';
import { decorPlacement } from '../look/designs';
import type { DecorDesign, DesignSource, DesignsFile } from '../look/designs';
import type { Box, CheckCard, FurnitureItem, SeatPose, Vec2 } from '../types';
import { KIND_NAMES, overlayFor } from '../look/fittings';
import type { FittingRecord, FittingsOverlay } from '../look/fittings';

export const SEAT_ID_PREFIX = 'seat:';
export const CHAIR_PROMPT = 'Sit on the chair';
/** Standing height used for the walk grid: a chair back, so it blocks like furniture. */
const CHAIR_BLOCK_HEIGHT_M = 0.9;
const VARIANT_NAME = { swivel: 'swivel chair', side: 'side chair' } as const;

export const CHAIR_FITTING_PREFIX = 'chair:';
export const CHAIR_LABEL = 'Chair marked on the drawing, shown in a typical style.';

export interface Seat {
  item: FurnitureItem;
  /** the drawing's chair this seat is (designs.json decor id) */
  decorId: string;
  /** where the drawing puts it, in the frame of the piece it stands at (the offset), and the spec to place it again when that piece moves */
  spec: DecorDesign;
  /** the standard chair size, for its tap box */
  /** the item this chair stands at */
  tiedTo: string;
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
  /** the ids of the items now in the home: a chair whose item is gone (hidden in a viewer's layout) is no longer a seat */
  setHostsPresent(present: ReadonlySet<string>): void;
  /** the pieces now in the home: a chair follows the piece it stands at when My layout moves or resizes that piece (unless the viewer moved the chair itself), and goes with it when it is hidden */
  syncHosts(items: readonly FurnitureItem[]): void;
  /** the viewer's removed and moved chairs (My layout) */
  setOverlay(o: FittingsOverlay | null): void;
  /** where each live chair stands now, by drawing id (for the matching decor mesh) */
  poseOf(decorId: string): { x: number; z: number; yawDeg: number } | null;
  isRemoved(decorId: string): boolean;
  /** the chairs as tappable, movable fittings (removed ones flagged) */
  records(): FittingRecord[];
  /** a key that changes when a chair appears, goes or stands somewhere else */
  stateKey(): string;
  /** ids of the seats that currently exist (changes when a host goes) */
  liveIds(): string[];
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
      decorId: spec.id, spec, seatM, seatSource: drawn ? 'drawing' : 'standard', provenance, tiedTo: spec.tiedTo,
      item: {
        id: SEAT_ID_PREFIX + spec.id, source: 'virtual', kind: 'sofa', label,
        box: { cx: at.x, cz: at.z, w: size.w, d: size.d, yawDeg: at.yawDeg },
        heightM: CHAIR_BLOCK_HEIGHT_M, surfaceHeightM: seatM,
      },
    });
  }
  let gone = new Set<string>();
  let overlay: FittingsOverlay | null = null;
  const fid = (s: Seat): string => CHAIR_FITTING_PREFIX + s.decorId;
  const removedBy = (s: Seat): boolean => overlayFor(overlay, fid(s)).removed;
  const live = (): Seat[] => seats.filter((s) => !gone.has(s.tiedTo) && !removedBy(s));
  /** the drawn box of a seat at its piece, as built */
  const drawnBox = new Map(seats.map((s) => [s.decorId, { ...s.item.box }]));
  let hostBoxes = new Map<string, FurnitureItem>();
  /** puts every seat where it stands now: at its piece (which may have moved), or where the viewer put it */
  const place = (): void => {
    for (const s of seats) {
      const host = hostBoxes.get(s.tiedTo);
      const at = host ? decorPlacement(s.spec, host) : null;
      const base: Box = at ? { ...s.item.box, cx: at.x, cz: at.z, yawDeg: at.yawDeg } : { ...(drawnBox.get(s.decorId) as Box) };
      const mv = overlayFor(overlay, fid(s)).move;
      s.item.box = mv?.m === 'f' ? { ...base, cx: mv.x, cz: mv.z, yawDeg: mv.yawDeg ?? base.yawDeg } : base;
    }
  };
  const find = (item: FurnitureItem): Seat | undefined => live().find((s) => s.item.id === item.id);
  return {
    seats,
    items: () => live().map((s) => s.item),
    isSeat: (item) => !!find(item),
    card(item, H) {
      const s = find(item);
      return s ? chairCheck(s.item.box.w, s.item.box.d, s.seatM, H, s.item.label, s.provenance) : null;
    },
    pose(item, H) {
      const s = find(item);
      return s ? chairPose(s.item.box, s.seatM, H) : null;
    },
    obstacles: () => live().map((s) => ({ box: s.item.box, heightM: s.item.heightM })),
    surfaceAt(p, tol = 0.25) {
      for (const s of live()) {
        if (Math.hypot(p.x - s.item.box.cx, p.z - s.item.box.cz) <= Math.max(s.item.box.w, s.item.box.d) / 2 + tol) return s.seatM;
      }
      return null;
    },
    setHostsPresent(present) { gone = new Set(seats.filter((s) => !present.has(s.tiedTo)).map((s) => s.tiedTo)); },
    syncHosts(items) {
      hostBoxes = new Map(items.map((i) => [i.id, i]));
      gone = new Set(seats.filter((s) => !hostBoxes.has(s.tiedTo)).map((s) => s.tiedTo));
      place();
    },
    setOverlay(o) { overlay = o; place(); },
    poseOf(decorId) {
      const s = seats.find((x) => x.decorId === decorId);
      return s ? { x: s.item.box.cx, z: s.item.box.cz, yawDeg: s.item.box.yawDeg } : null;
    },
    isRemoved: (decorId) => { const s = seats.find((x) => x.decorId === decorId); return !!s && removedBy(s); },
    records() {
      const out: FittingRecord[] = [];
      for (const s of seats) {
        if (gone.has(s.tiedTo)) continue;
        const ov = overlayFor(overlay, fid(s));
        const b = s.item.box;
        const d0 = drawnBox.get(s.decorId) as Box;
        out.push({
          id: fid(s), kind: 'chair', name: s.item.label || KIND_NAMES.chair, mount: 'floor', roomId: '', removed: ov.removed, moved: ov.move?.m === 'f' && (Math.abs(b.cx - d0.cx) > 1e-6 || Math.abs(b.cz - d0.cz) > 1e-6 || Math.abs(b.yawDeg - d0.yawDeg) > 1e-6),
          sized: false, centre: { x: b.cx, y: 0.45, z: b.cz }, half: { x: b.w / 2, y: 0.45, z: b.d / 2 }, yawDeg: b.yawDeg,
          size: { w: b.w, d: b.d, h: s.item.heightM }, heightM: 0, provenance: 'typical', label: CHAIR_LABEL, movable: true,
          moveRule: { mount: 'floor', w: b.w, d: b.d, needFree: true, doorKeepM: 0.3, turn: true }, resize: null, defaultSize: null, currentSize: null,
        });
      }
      return out;
    },
    stateKey: () => live().map((s) => `${s.decorId}:${s.item.box.cx.toFixed(3)}:${s.item.box.cz.toFixed(3)}:${s.item.box.yawDeg.toFixed(1)}`).join('|'),
    liveIds: () => live().map((s) => s.item.id),
  };
}
