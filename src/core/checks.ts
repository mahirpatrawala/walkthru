// Body checks (SPEC 4.7). Pure. Copy is exactly as in 2.1.
import type { BedFit, CheckCard, FurnitureItem } from '../types';
import { specFor } from './catalog';
import { fixtureSizeNote } from './fixtures';
import { chainLengthM, pieceRule, swingReachM, swingZone } from './pieces';
import { zoneAssumption, zoneNeedM } from './clearance';

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

/** Ideal seat height is a quarter of body height, give or take 5 cm (the sofa rule, reused by chairs). */
export function seatHeightVerdict(seatHeightM: number, heightM: number): { tone: CheckCard['tone']; line: string } {
  const diff = seatHeightM - 0.25 * heightM;
  const h = cm(seatHeightM);
  if (Math.abs(diff) <= 0.05 + 1e-9) return { tone: 'good', line: `Seat height ${h} cm suits you.` };
  if (diff > 0) return { tone: 'warn', line: `Seat height ${h} cm is high. Your feet may not rest flat.` };
  return { tone: 'warn', line: `Seat height ${h} cm is low. Your knees sit above your hips.` };
}

/** Sit on the sofa. Seats `max(1, floor(W / 0.6))`; ideal seat height is a quarter of body height, give or take 5 cm. */
export function sofaCheck(widthM: number, seatHeightM: number, heightM: number, label: string): CheckCard {
  const seats = Math.max(1, Math.floor(widthM / 0.6 + 1e-9));
  const v = seatHeightVerdict(seatHeightM, heightM);
  return { title: `${label} · ${cm(widthM)} cm wide`, tone: v.tone, headline: `Seats ${seats}.`, lines: [v.line] };
}

/**
 * Sit on a chair: the sofa's seat-height verdict (`seatHeightVerdict`, a quarter of body height give or take 5 cm), no seat
 * count. `provenance` says where the seat height came from, so the card never presents an unsourced number as drawn.
 */
export function chairCheck(widthM: number, depthM: number, seatHeightM: number, heightM: number, label: string, provenance: string): CheckCard {
  const v = seatHeightVerdict(seatHeightM, heightM);
  return { title: `${label} · ${cm(widthM)} × ${cm(depthM)} cm`, tone: v.tone, headline: v.line, lines: [], footer: provenance };
}

/** Stand at the counter. Comfortable top is `0.63 * height - 0.15`, give or take 7 cm (a basin or a sink, a fitting with a standard rim, is judged give or take 12 cm). */
export function counterCheck(topM: number, heightM: number, label: string, tolM = 0.07): CheckCard {
  const diff = topM - (0.63 * heightM - 0.15);
  let tone: CheckCard['tone'];
  let headline: string;
  if (Math.abs(diff) <= tolM + 1e-9) {
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

/** The lines of the "see dimensions" card of a piece with zones: what it needs, and the one dimension that was assumed. */
function zoneLines(item: FurnitureItem, ceilingM: number): string[] {
  const rule = pieceRule(item.catalogId);
  if (!rule) return [];
  // the item's own footprint: a piece the viewer resized needs the space of its new size
  const spec = { ...specFor(item), footprint: { w: item.box.w, d: item.box.d } };
  const out: string[] = [];
  for (const z of rule.zones ?? []) {
    if (z.swing) continue;
    out.push(`Needs ${cm(zoneNeedM(z, spec, z.sides[0], ceilingM))} cm clear ${z.where} (${zoneAssumption(z, spec.footprint)}).`);
  }
  if (rule.mountY) out.push(`Fixed to the wall, its underside ${cm(rule.mountY)} cm above the floor.`);
  return out;
}

function sourceFooter(item: FurnitureItem, rule: ReturnType<typeof pieceRule>): string | undefined {
  const fx = fixtureSizeNote(item.id);
  if (fx) return rule?.note ? `${fx} ${rule.note}` : fx;
  if (rule?.note) return rule.note;
  return item.source === 'real' ? undefined : `Standard ${specFor(item).name} size.`;
}

/** A seat on chains: seat height against the walker, how many it seats, how far it travels each way. */
export function swingCheck(item: FurnitureItem, heightM: number, ceilingM: number): CheckCard {
  const rule = pieceRule(item.catalogId);
  const z = swingZone(item.catalogId);
  const v = seatHeightVerdict(item.surfaceHeightM, heightM);
  const variant = String(rule?.look.params?.variant ?? '');
  const seats = variant.startsWith('chair') ? 1 : variant.endsWith('3') ? 3 : 2;
  const lines = [v.line];
  if (z?.swing) {
    const L = chainLengthM(z, ceilingM);
    const reach = swingReachM(L, z.swing.angleDeg);
    lines.push(`Swings about ${cm(reach)} cm each way (${z.swing.angleDeg}° on ${cm(L)} cm of chain).`);
  }
  return {
    title: `${item.label} · ${cm(item.box.w)} × ${cm(item.box.d)} cm`, tone: v.tone, headline: seats === 1 ? 'Seats one.' : `Seats ${seats}.`,
    lines, footer: sourceFooter(item, rule),
  };
}

/** The card for a catalogue piece that has a rule of its own (src/core/pieces.ts), or null. */
function pieceCard(item: FurnitureItem, heightM: number, ceilingM: number): CheckCard | null {
  const rule = pieceRule(item.catalogId);
  if (!rule) return null;
  const footer = sourceFooter(item, rule);
  const zl = zoneLines(item, ceilingM);
  // a seat on a machine, a bike or a bench is not judged against a chair: its height is the machine's (many adjust), so the card gives the size and the seat
  if (rule.seat && (rule.pose === 'chair' || rule.pose === 'sit')) {
    const c = dimensionsCard(item);
    return { ...c, lines: [`Seat at ${cm(item.surfaceHeightM)} cm${/bike|rower|rowing/i.test(item.label) ? ' (the saddle or seat adjusts)' : ''}.`, ...zl], footer };
  }
  switch (rule.pose) {
    case 'lie': {
      const sleep = item.inner ?? { w: item.box.w, d: item.box.d };
      if (item.catalogId === 'yoga-mat') {
        const spare = cm(sleep.d - heightM);
        const tone = spare >= 15 ? 'good' : spare >= 0 ? 'warn' : 'bad';
        return {
          title: `${item.label} · ${cm(sleep.w)} × ${cm(sleep.d)} cm`, tone,
          headline: spare >= 15 ? 'You fit.' : spare >= 0 ? 'Tight fit.' : 'Too short for you.',
          lines: [spare >= 0 ? `${spare} cm to spare at ${cm(heightM)} cm tall.` : `Your feet go ${-spare} cm off the end.`, `${cm(sleep.w)} cm wide, room for one.`], footer,
        };
      }
      const c = bedFit(sleep.d, sleep.w, heightM, item.label, footer ?? '').card;
      return { ...c, lines: [...c.lines, ...zl], footer };
    }
    case 'sit': {
      const c = sofaCheck(item.box.w, item.surfaceHeightM, heightM, item.label);
      return { ...c, lines: [...c.lines, ...zl], footer };
    }
    case 'chair': {
      const c = chairCheck(item.box.w, item.box.d, item.surfaceHeightM, heightM, item.label, footer ?? `Standard ${specFor(item).name} size.`);
      return { ...c, lines: zl };
    }
    case 'swing': return swingCheck(item, heightM, ceilingM);
    case 'stand': {
      const c = counterCheck(item.surfaceHeightM, heightM, item.label, rule.category === 'bathroom' || rule.category === 'kitchen' ? 0.12 : 0.07);
      return { ...c, lines: [...c.lines, ...zl], footer };
    }
    default: {
      const c = dimensionsCard(item);
      return { ...c, lines: [...zl], footer };
    }
  }
}

/** The card for the item's pose, by kind (a catalogue piece with a rule of its own picks its own). `ceilingM` is for a swing's chains. */
export function checkFor(item: FurnitureItem, heightM: number, ceilingM = 2.7): CheckCard {
  const own = pieceCard(item, heightM, ceilingM);
  if (own) return own;
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
