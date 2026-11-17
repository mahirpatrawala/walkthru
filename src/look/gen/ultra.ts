// SPEC 16.24 "2K top quality": the extra geometry detail of the style generators is gated here, on one switch. Off and 1K never read anything but
// the tier's own `GEN_QUALITY`, so they cost exactly what they did; the 2K level raises the switch (look.ts) and the furniture is rebuilt with the
// finer table below. Pure (no DOM), so the tests and the Node GLB export can use it.
import type { Tier } from '../types';
import { GEN_QUALITY } from './core';
import type { GenQuality } from './core';

let ultra = false;
/** raised by the look while the level drawn is 2K */
export function setUltraDetail(on: boolean): void { ultra = on; }
export function ultraDetail(): boolean { return ultra; }

/** what 2K buys over the high tier: rounded (not chamfered) edges, 24-sided rounds, a finer cushion and cloth grid */
export const ULTRA_QUALITY: GenQuality = { ...GEN_QUALITY.high, ultra: true, edge: 0.004, sides: 24, puff: 16, cloth: 48, seg: 4 };

/** the quality table the builders read: the tier's own, or the 2K one on medium and high while the switch is up (never on low) */
export function genQuality(tier: Tier): GenQuality {
  return ultra && tier !== 'low' ? ULTRA_QUALITY : GEN_QUALITY[tier];
}
