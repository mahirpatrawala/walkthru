const M_PER_IN = 0.0254;

/** Curly and prime quote marks to plain ' and ". */
function normalise(text: string): string {
  return text
    .replace(/[‘’′ʹ]/g, "'")
    .replace(/[“”″ʺ]/g, '"')
    .replace(/''/g, '"')
    .trim()
    .toLowerCase();
}

const NUM = '(\\d+(?:\\.\\d+)?|\\.\\d+)';
const RE_BARE = new RegExp(`^${NUM}$`);
const RE_METRIC = new RegExp(`^${NUM}\\s*(m|metres?|meters?|cm|mm)$`);
const RE_FT_IN = new RegExp(`^${NUM}\\s*(?:'|ft|feet|foot)\\s*(?:${NUM}\\s*(?:"|in|inch|inches)?)?$`);
const RE_IN = new RegExp(`^${NUM}\\s*(?:"|in|inch|inches)$`);

/**
 * Metres, or null if the text is not a positive length. Accepts 4, 4.0, 4 m, 400 cm, 4000 mm,
 * 13'1", 13' 1", 13 ft 1 in, 13ft, 13', 157", 157 in. A bare number is metres.
 */
export function parseLength(text: string): number | null {
  const t = normalise(text);
  if (!t) return null;
  let m: RegExpMatchArray | null;
  let result: number;
  if ((m = t.match(RE_BARE))) {
    result = parseFloat(m[1]);
  } else if ((m = t.match(RE_METRIC))) {
    const v = parseFloat(m[1]);
    const unit = m[2];
    result = unit === 'cm' ? v / 100 : unit === 'mm' ? v / 1000 : v;
  } else if ((m = t.match(RE_FT_IN))) {
    result = (parseFloat(m[1]) * 12 + (m[2] ? parseFloat(m[2]) : 0)) * M_PER_IN;
  } else if ((m = t.match(RE_IN))) {
    result = parseFloat(m[1]) * M_PER_IN;
  } else {
    return null;
  }
  return Number.isFinite(result) && result > 0 ? result : null;
}

/** "4.0 x 5.0", "13'1\" × 16'5\"", "4 by 5". Both parts must parse. */
export function parseSize(text: string): { w: number; l: number } | null {
  const parts = normalise(text).split(/\s+by\s+|\s*[x×]\s*/);
  if (parts.length !== 2) return null;
  const w = parseLength(parts[0]);
  const l = parseLength(parts[1]);
  if (w === null || l === null) return null;
  return { w, l };
}

function feetInches(m: number): { ft: number; inch: number } {
  const total = Math.round(m / M_PER_IN);
  return { ft: Math.floor(total / 12), inch: total % 12 };
}

/** 13'1" (inches rounded, so 12 inches always carries into feet). */
export function formatFtIn(m: number): string {
  const { ft, inch } = feetInches(m);
  return `${ft}'${inch}"`;
}

/** Under 1 m: "62 cm · 2 ft 0 in". Otherwise "2.43 m · 8 ft 0 in". */
export function formatLength(m: number): string {
  const { ft, inch } = feetInches(m);
  const imperial = `${ft} ft ${inch} in`;
  if (m < 1) return `${Math.round(m * 100)} cm · ${imperial}`;
  return `${m.toFixed(2)} m · ${imperial}`;
}

/** '215 sq ft · 20.0 m²' */
export function formatArea(m2: number): { sqft: number; m2: string; text: string } {
  const sqft = Math.round(m2 * 10.7639);
  const m2s = m2.toFixed(1);
  return { sqft, m2: m2s, text: `${sqft} sq ft · ${m2s} m²` };
}

/** '175 cm · 5 ft 9 in' */
export function formatHeight(cm: number): string {
  const total = Math.round(cm / 2.54);
  return `${cm} cm · ${Math.floor(total / 12)} ft ${total % 12} in`;
}
