// What the identity pill and its card say (SPEC 2.7), and the one unit of area they say it in. Pure: tests/chrome-reveal.test.ts.

/** Areas are shown in one unit at a time: square feet (the default, how flats are sold here) or square metres. */
export type AreaUnits = 'sqft' | 'm2';
export const UNITS_KEY = 'walkthru:units';
export const UNITS_EVENT = 'walkthru:units';
const SQFT_PER_M2 = 10.7639;

export function unitsFrom(v: unknown): AreaUnits | null {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  if (s === 'm2' || s === 'm²' || s === 'sqm' || s === 'metric') return 'm2';
  if (s === 'sqft' || s === 'sq-ft' || s === 'ft' || s === 'imperial') return 'sqft';
  return null;
}

/** `?units=m2|sqft` wins, then the viewer's saved choice, then square feet. */
export function loadUnits(search: string, read: () => string | null): AreaUnits {
  let q: string | null = null;
  try { q = new URLSearchParams(search).get('units'); } catch { q = null; }
  let saved: string | null = null;
  try { saved = read(); } catch { saved = null; }
  return unitsFrom(q) ?? unitsFrom(saved) ?? 'sqft';
}

const num = (s: string): number => Number(s.replace(/,/g, ''));
const group = (n: number): string => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/**
 * The same words with every area in one unit: "228 sq ft · 21.1 m²" keeps the half asked for, a lone "1,117 sq ft" (a builder's stated carpet
 * area) is converted when square metres are asked for and the other way round. Words that carry no area ("Not measured") pass through.
 */
export function areaIn(text: string, units: AreaUnits): string {
  const PAIR = /([\d,]+(?:\.\d+)?)\s*sq\s*ft\s*·\s*([\d,]+(?:\.\d+)?)\s*m²/g;
  let out = text.replace(PAIR, (_m, ft: string, m2: string) => (units === 'sqft' ? `${ft} sq ft` : `${m2} m²`));
  if (units === 'm2') out = out.replace(/([\d,]+(?:\.\d+)?)\s*sq\s*ft/g, (_m, ft: string) => `${(num(ft) / SQFT_PER_M2).toFixed(1)} m²`);
  else out = out.replace(/([\d,]+(?:\.\d+)?)\s*m²/g, (_m, m2: string) => `${group(num(m2) * SQFT_PER_M2)} sq ft`);
  return out;
}

const AREA = /\d\s*(sq\s*ft|m²)/;

/** The one line of the resting pill: the place's own name and what it is, never its area or its level ("Flat 204 · 3 BHK"). */
export function pillText(place: string): string {
  const parts = place.split(' · ').map((p) => p.trim()).filter(Boolean);
  const keep: string[] = [];
  for (const p of parts) { if (AREA.test(p) || keep.length >= 2) break; keep.push(p); }
  return keep.join(' · ') || place.trim();
}

export interface IdentityLines {
  /** the resting pill */
  pill: string;
  /** the card's first line: the place with its stated area, in the unit asked for */
  place: string;
  /** the card's second line: the level and the room you stand in with its area ("Level 2 · Living 228 sq ft"), or null when there is neither */
  where: string | null;
  /** the room line carries a warning (a size that is not measured, a shape that is guessed): it is also shown once as its own pill */
  warn: string | null;
}

/**
 * `place` is the place's name ("Flat 204 · 3 BHK · 1,117 sq ft"), `level` its level's label ("Level 2") or null, `room` the room chip as the
 * walk words it ("Living · 228 sq ft · 21.1 m²", "Store · not measured (no dimension on the drawing)", "Terrace · shape guessed") or null.
 */
export function identityLines(place: string, level: string | null, room: string | null, units: AreaUnits): IdentityLines {
  let where: string | null = null;
  let warn: string | null = null;
  if (room) {
    const i = room.indexOf(' · ');
    const name = i < 0 ? room : room.slice(0, i);
    const rest = i < 0 ? '' : room.slice(i + 3);
    if (/not measured|shape guessed/i.test(rest)) { where = `${name} · ${rest}`; warn = `${name}: ${rest}`; }
    else where = rest ? `${name} ${areaIn(rest, units)}` : name;
  }
  if (level) where = where ? `${level} · ${where}` : level;
  return { pill: pillText(place), place: areaIn(place, units), where, warn };
}
