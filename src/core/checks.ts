// Body checks (SPEC 4.7). Pure. Copy is exactly as in 2.1.
import type { BedFit, CheckCard, FurnitureItem } from '../types';
import { specFor } from './catalog';

/** Whole centimetres, never -0. */
function cm(m: number): number {
  return Math.round(m * 100) + 0;
}

/** The width line of the bed card, and how many people it sleeps. */
function widthLine(wCm: number): { text: string; sleeps: 0 | 1 | 2 } {
  if (wCm >= 135) return { text: `${wCm} cm wide, sleeps two.`, sleeps: 2 };
  if (wCm >= 90) return { text: `${wCm} cm wide, sleeps one.`, sleeps: 1 };
  if (wCm >= 75) return { text: `${wCm} cm wide, a narrow single.`, sleeps: 1 };
  return { text: `${wCm} cm wide, too narrow to sleep on.`, sleeps: 0 };
}

/**
 * Lie on the bed. `spareCm = round((sleepLength - height) * 100)`: 15 or more fits, 0 to 14 is tight, below 0 is
 * too short. `sleeps` follows the width line (a narrow single counts as one, under 75 cm as none).
 */
export function bedFit(
  sleepLengthM: number, sleepWidthM: number, heightM: number, label: string, footer: string,
): BedFit {
  const spareCm = cm(sleepLengthM - heightM);
  const heightCm = cm(heightM);
  const wCm = cm(sleepWidthM);
  const width = widthLine(wCm);
  let verdict: BedFit['verdict'];
  let tone: CheckCard['tone'];
  let headline: string;
  let detail: string;
  if (spareCm >= 15) {
    verdict = 'fits'; tone = 'good'; headline = 'You fit.';
    detail = `${spareCm} cm to spare at ${heightCm} cm tall.`;
  } else if (spareCm >= 0) {
    verdict = 'tight'; tone = 'warn'; headline = 'Tight fit.';
    detail = `Only ${spareCm} cm to spare. Your feet reach the end.`;
  } else {
    verdict = 'too-short'; tone = 'bad'; headline = 'Too short for you.';
    detail = `Your feet hang ${-spareCm} cm over the end.`;
  }
  return {
    verdict, spareCm, sleeps: width.sleeps,
    card: { title: `${label} · ${wCm} × ${cm(sleepLengthM)} cm`, tone, headline, lines: [detail, width.text], footer },
  };
}

/** Sit on the sofa. Seats `max(1, floor(W / 0.6))`; ideal seat height is a quarter of body height, give or take 5 cm. */
export function sofaCheck(widthM: number, seatHeightM: number, heightM: number, label: string): CheckCard {
  const seats = Math.max(1, Math.floor(widthM / 0.6 + 1e-9));
  const diff = seatHeightM - 0.25 * heightM;
  const h = cm(seatHeightM);
  let tone: CheckCard['tone'];
  let line: string;
  if (Math.abs(diff) <= 0.05 + 1e-9) {
    tone = 'good'; line = `Seat height ${h} cm suits you.`;
  } else if (diff > 0) {
    tone = 'warn'; line = `Seat height ${h} cm is high. Your feet may not rest flat.`;
  } else {
    tone = 'warn'; line = `Seat height ${h} cm is low. Your knees sit above your hips.`;
  }
  return { title: `${label} · ${cm(widthM)} cm wide`, tone, headline: `Seats ${seats}.`, lines: [line] };
}

/** Stand at the counter. Comfortable top is `0.63 * height - 0.15`, give or take 7 cm. */
export function counterCheck(topM: number, heightM: number, label: string): CheckCard {
  const diff = topM - (0.63 * heightM - 0.15);
  let tone: CheckCard['tone'];
  let headline: string;
  if (Math.abs(diff) <= 0.07 + 1e-9) {
    tone = 'good'; headline = 'Comfortable working height for you.';
  } else if (diff < 0) {
    tone = 'warn'; headline = 'Low for you. Expect to stoop.';
  } else {
    tone = 'warn'; headline = 'High for you.';
  }
  return { title: `${label} · ${cm(topM)} cm high`, tone, headline, lines: [] };
}

/** Dining tables and wardrobes: a size card, tone good, no pose. */
export function dimensionsCard(item: FurnitureItem): CheckCard {
  return {
    title: item.label,
    tone: 'good',
    headline: `${cm(item.box.w)} × ${cm(item.box.d)} × ${cm(item.heightM)} cm`,
    lines: [],
  };
}

/** The card for the item's pose, by kind. */
export function checkFor(item: FurnitureItem, heightM: number): CheckCard {
  switch (item.kind) {
    case 'bed': {
      const sleep = item.inner ?? { w: item.box.w, d: item.box.d };
      const footer = item.source === 'real'
        ? 'Measured from the floor plan, accurate to about 5 cm.'
        : `Standard ${specFor(item).name} size.`;
      return bedFit(sleep.d, sleep.w, heightM, item.label, footer).card;
    }
    case 'sofa':
      return sofaCheck(item.box.w, item.surfaceHeightM, heightM, item.label);
    case 'counter':
      return counterCheck(item.surfaceHeightM, heightM, item.label);
    default:
      return dimensionsCard(item);
  }
}
