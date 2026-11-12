// Owned by C2. Stub from C0: signatures only (SPEC 7.1, copy in 2.1 and 4.7).
import type { BedFit, CheckCard, FurnitureItem } from '../types';

export function bedFit(sleepLengthM: number, sleepWidthM: number, heightM: number, label: string, footer: string): BedFit {
  throw new Error('not implemented: C2 bedFit');
}
export function sofaCheck(widthM: number, seatHeightM: number, heightM: number, label: string): CheckCard {
  throw new Error('not implemented: C2 sofaCheck');
}
export function counterCheck(topM: number, heightM: number, label: string): CheckCard {
  throw new Error('not implemented: C2 counterCheck');
}
export function dimensionsCard(item: FurnitureItem): CheckCard {
  throw new Error('not implemented: C2 dimensionsCard');
}
/** dispatches on kind */
export function checkFor(item: FurnitureItem, heightM: number): CheckCard {
  throw new Error('not implemented: C2 checkFor');
}
