// The depth card (SPEC 19.3): the water against a person, the product's point for a pool. A section drawing of the pool along its length with a
// figure of the chosen height standing at the shallow end, the middle and the deep end, and the sentence that says what the water reaches on them.
// Pure (strings and numbers), so it is tested without a page. Every guidance line is labelled typical guidance, never code.
import type { PoolBasin } from './types';
import { ADULT, CHILD, POOL_GUIDANCE, TODDLER, depthRows, depthSentence, levelAgainst, profileDepth, waterLevelY } from './pool';
import type { Person } from './pool';

export const PEOPLE_PRESETS: Person[] = [ADULT, CHILD, TODDLER];

export interface DepthCardModel {
  title: string;
  /** the one sentence: "Water reaches 1.3 m: chest-deep for a 175 cm adult; over a 120 cm child's head." */
  headline: string;
  /** shallow and deep end for the person chosen */
  rows: { label: string; text: string }[];
  /** what the water is where the walker stands (the nearest water), when given */
  here: string | null;
  svg: string;
  notes: string[];
}

const esc = (s: string): string => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

/** The section drawing: width 360, height 214. Scale is one metre of depth to 70 px along and across, so a figure is as tall as the water is deep. */
export function sectionSvg(b: PoolBasin, person: Person, deckToWaterM = 0.12): string {
  const W = 360, S = 70, x0 = 24, x1 = 336, wy = 72;
  const floorAt = (u: number): number => wy + profileDepth(b, u) * S;
  const xAt = (u: number): number => x0 + u * (x1 - x0);
  const parts: string[] = [];
  // the water and the basin under it
  const pts = [`${x0},${wy}`, ...b.profile.map((p) => `${xAt(p[0]).toFixed(1)},${floorAt(p[0]).toFixed(1)}`), `${x1},${wy}`];
  parts.push(`<polygon points="${pts.join(' ')}" fill="#7FC6DA" opacity="0.55"/>`);
  parts.push(`<polyline points="${b.profile.map((p) => `${xAt(p[0]).toFixed(1)},${floorAt(p[0]).toFixed(1)}`).join(' ')}" fill="none" stroke="#2F6F97" stroke-width="3" stroke-linejoin="round"/>`);
  parts.push(`<line x1="${x0}" y1="${wy - deckToWaterM * S}" x2="${x0 - 14}" y2="${wy - deckToWaterM * S}" stroke="#8D8473" stroke-width="3"/><line x1="${x1}" y1="${wy - deckToWaterM * S}" x2="${x1 + 14}" y2="${wy - deckToWaterM * S}" stroke="#8D8473" stroke-width="3"/>`);
  parts.push(`<line x1="${x0}" y1="${wy - deckToWaterM * S}" x2="${x0}" y2="${floorAt(0)}" stroke="#2F6F97" stroke-width="3"/><line x1="${x1}" y1="${wy - deckToWaterM * S}" x2="${x1}" y2="${floorAt(1)}" stroke="#2F6F97" stroke-width="3"/>`);
  // the figures: at the shallow end, the middle and the deep end
  const lowP = b.profile.reduce((m, p) => (p[1] < m[1] ? p : m), b.profile[0]);
  const hiP = b.profile.reduce((m, p) => (p[1] > m[1] ? p : m), b.profile[0]);
  const lastHi = [...b.profile].reverse().find((p) => p[1] >= hiP[1] - 1e-6) ?? hiP;
  const shallowU = Math.min(0.9, lowP[0] + 0.1);
  const deepU = lastHi[0] - hiP[0] > 0.15 ? (hiP[0] + lastHi[0]) / 2 : Math.min(0.94, hiP[0] + 0.03);
  const sloped = hiP[1] - lowP[1] > 0.05;
  const stations = sloped ? [shallowU, (shallowU + deepU) / 2, deepU] : [0.15, 0.5, 0.85];
  const h = (person.heightCm / 100) * S;
  for (const u of stations) {
    const x = xAt(u), fy = floorAt(u), d = profileDepth(b, u);
    const top = fy - h;
    const body = `<rect x="${(x - h * 0.11).toFixed(1)}" y="${(top + h * 0.14).toFixed(1)}" width="${(h * 0.22).toFixed(1)}" height="${(h * 0.86).toFixed(1)}" rx="${(h * 0.07).toFixed(1)}" fill="#B5502C"/>`;
    const head = `<circle cx="${x.toFixed(1)}" cy="${(top + h * 0.07).toFixed(1)}" r="${(h * 0.07).toFixed(1)}" fill="#6B3B22"/>`;
    parts.push(body, head);
    // the water in front of the figure
    parts.push(`<rect x="${(x - h * 0.16).toFixed(1)}" y="${wy}" width="${(h * 0.32).toFixed(1)}" height="${Math.max(0, fy - wy).toFixed(1)}" fill="#3C9BBE" opacity="0.3"/>`);
    const lv = levelAgainst(d, person.heightCm);
    parts.push(`<text x="${x.toFixed(1)}" y="${(fy + 15).toFixed(1)}" font-size="13" text-anchor="middle" fill="#1F4E6B" font-weight="700">${d.toFixed(1)} m</text>`);
    parts.push(`<text x="${x.toFixed(1)}" y="${Math.max(11, top - 5).toFixed(1)}" font-size="11" text-anchor="middle" fill="#3A302A">${esc(lv.overHead ? 'over the head' : lv.word)}</text>`);
  }
  parts.push(`<line x1="${x0 - 14}" y1="${wy}" x2="${x1 + 14}" y2="${wy}" stroke="#2F8FB5" stroke-width="1.5" stroke-dasharray="5 4"/>`);
  return `<svg viewBox="0 0 ${W} 214" role="img" aria-label="Section of the pool with ${esc(person.label.toLowerCase())} of ${person.heightCm} cm standing at three places">${parts.join('')}</svg>`;
}

/** The card for a pool, a person (and a second one to set beside them), and optionally the depth where the walker stands. */
export function depthCardModel(b: PoolBasin, person: Person, other: Person | null, hereDepthM: number | null): DepthCardModel {
  const people = other && other.id !== person.id ? [person, other] : [person];
  const rows = depthRows(b, person, other ?? CHILD).map((r) => ({ label: r.label, text: depthSentence(r.depthM, people) }));
  const deep = Math.max(...b.profile.map((p) => p[1]));
  const kidsNote = b.kids ? ['Typical guidance, not code: this children\'s pool should stay at about 0.6 m or less.'] : [];
  return {
    title: b.kids ? "Children's pool depth" : 'Pool depth',
    headline: depthSentence(hereDepthM ?? deep, people),
    rows,
    here: hereDepthM === null ? null : `Where you stand the water is ${hereDepthM.toFixed(1)} m deep.`,
    svg: sectionSvg(b, person, b.waterBelowDeckM),
    notes: [...kidsNote, ...POOL_GUIDANCE],
  };
}

export const waterY = waterLevelY;
