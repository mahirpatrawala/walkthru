// The landing hero's construction sequence, as numbers: where each built floor is in its stages at a given second, when the roof
// lands, when the labels show, which storey is lit while the finished building holds, and the fade before it starts again. Pure.

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
export const ease = (t: number): number => { const k = clamp01(t); return k * k * (3 - 2 * k); };

/** seconds */
export const STAND_S = 1.4;
export const SLAB_S = 0.9, PLAN_S = 1.7, WALLS_S = 1.2, FURNISH_S = 1.6, FACADE_S = 1.6;
export const FLOOR_S = SLAB_S + PLAN_S + WALLS_S + FURNISH_S + FACADE_S;
export const ROOF_S = 1.1, LABELS_S = 0.8, HOLD_S = 9, LIT_S = 1.5, RESET_S = 1.6;

/** One floor's construction, each stage 0 (not begun) to 1 (done): the slab slides in, the plan draws, the walls rise, furniture lands, the facade closes. */
export interface FloorStage { slab: number; plan: number; walls: number; furnish: number; facade: number }
export interface BuildState {
  /** the storeys that stand from the start, drawing in (first pass only) */
  stand: number;
  floors: FloorStage[];
  roof: number;
  /** the labels of what is built in the sequence (the others show once the standing part is in) */
  labels: number;
  /** while the finished building holds: which storey of the tower is lit, as a position along them (0 is the lowest), or -1 */
  lit: number;
  /** 1, falling to 0 as the built floors are taken away before the next round */
  keep: number;
  /** seconds into the current round, for things that move on their own (the walker) */
  round: number;
}
const DONE: FloorStage = { slab: 1, plan: 1, walls: 1, furnish: 1, facade: 1 };

export const roundSeconds = (floors: number): number => floors * FLOOR_S + ROOF_S + LABELS_S + HOLD_S + RESET_S;

/** The finished building: what reduced motion shows, and the frame a capture can ask for. */
export function finished(floors: number): BuildState {
  return { stand: 1, floors: Array.from({ length: floors }, () => ({ ...DONE })), roof: 1, labels: 1, lit: -1, keep: 1, round: 0 };
}

/** `t` seconds since the picture first appeared; `floors` floors are built one after the other; `storeys` storeys of the tower can be lit. */
export function buildState(t: number, floors: number, storeys: number): BuildState {
  const stand = ease(t / STAND_S);
  const total = roundSeconds(floors);
  const tau = t < STAND_S ? -1 : (t - STAND_S) % total;
  const stage = (k: number): FloorStage => {
    const s = tau - k * FLOOR_S;
    return {
      slab: ease(s / SLAB_S), plan: ease((s - SLAB_S) / PLAN_S), walls: ease((s - SLAB_S - PLAN_S) / WALLS_S),
      furnish: ease((s - SLAB_S - PLAN_S - WALLS_S) / FURNISH_S), facade: ease((s - SLAB_S - PLAN_S - WALLS_S - FURNISH_S) / FACADE_S),
    };
  };
  const built = floors * FLOOR_S, hold0 = built + ROOF_S + LABELS_S, reset0 = total - RESET_S;
  const inHold = tau >= hold0 && tau < reset0 && storeys > 0;
  return {
    stand,
    floors: Array.from({ length: floors }, (_, k) => stage(k)),
    roof: ease((tau - built) / ROOF_S),
    labels: ease((tau - built - ROOF_S) / LABELS_S) * (1 - ease((tau - reset0) / (RESET_S * 0.5))),
    lit: inHold ? ((tau - hold0) / LIT_S) % storeys : -1,
    keep: 1 - ease((tau - reset0 - RESET_S * 0.2) / (RESET_S * 0.8)),
    round: Math.max(0, tau),
  };
}
