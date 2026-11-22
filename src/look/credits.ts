// Credits for the downloaded assets the build ships (CC BY 4.0 requires a visible credit; CC0 needs none but is listed too). Every fetch script
// keeps its own lock file under public/look/ in its own shape (models.lock.json, gym.lock.json, outdoor/sources.lock.json, home/home.lock.json,
// and whatever later scripts add). This reads them all without knowing their shape: it walks each file and takes every object that names a
// licence and a source page. A missing file, a file that is not JSON, or an entry with fields it does not know is skipped, never thrown.
// Pure: no DOM (src/buyer/credits-panel.ts shows the list).

export interface Credit {
  title: string;
  author: string;
  /** the source page of the asset (where a viewer can see it and its licence) */
  url: string;
  licence: string;
  licenceUrl: string;
  /** which lock file listed it (public path) */
  lock: string;
}

/** CC BY in any version, never with NC, ND or SA (those are not allowed in the build; if one ever appeared it is still credited, but `isAttribution` says so) */
export function isAttribution(licence: string): boolean {
  return /\bCC[\s-]*BY\b/i.test(licence) || /creative commons attribution/i.test(licence) || /\/licenses\/by\//i.test(licence);
}
export function isPublicDomain(licence: string): boolean { return /\bCC0\b/i.test(licence) || /public domain/i.test(licence); }
/** a licence the build must not ship (SPEC 16.15: CC0 or CC BY 4.0 only) */
export function isForbiddenLicence(licence: string): boolean { return /\b(NC|ND|SA)\b|non-?commercial|no-?deriv|share-?alike|editorial/i.test(licence); }

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const LIC_URL: [RegExp, string][] = [
  [/\bCC0\b/i, 'https://creativecommons.org/publicdomain/zero/1.0/'],
  [/\bCC[\s-]*BY\b|attribution/i, 'https://creativecommons.org/licenses/by/4.0/'],
];

/** keys whose contents are not shipped assets (looked at and refused, or how a file was produced) */
const SKIP_KEYS = new Set(['rejected', 'candidates', 'routes', 'outputs', 'notUsed', 'considered']);

function creditOf(o: Record<string, unknown>, lock: string, key: string): Credit | null {
  const licence = str(o.licence) || str(o.license);
  if (!licence) return null;
  const url = str(o.page) || str(o.url) || str(o.source) || str(o.sourceUrl);
  if (!/^https?:\/\//.test(url)) return null;
  const authors = Array.isArray(o.authors) ? o.authors.map(str).filter(Boolean).join(', ') : '';
  const author = authors || str(o.author) || str(o.creator) || str(o.by);
  // a lock keyed by file path (an outdoor map) has no title: the asset's name is the last part of its page, made readable
  const fromPage = (): string => decodeURIComponent(url.replace(/[?#].*$/, '').replace(/\/$/, '').split('/').pop() ?? '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  const named = str(o.name) || str(o.title) || str(o.id);
  const title = named && !/^\S+\/\S+$/.test(named) ? named : fromPage() || key;
  const licenceUrl = str(o.licenceUrl) || str(o.licencePage) || str(o.licenseUrl) || str(o.licensePage) || (LIC_URL.find(([re]) => re.test(licence))?.[1] ?? '');
  return { title, author: author || 'unknown author', url, licence, licenceUrl, lock };
}

/** Every credit found in one parsed lock file (`json` may be anything). */
export function creditsFromLock(json: unknown, lock: string): Credit[] {
  const out: Credit[] = [];
  const walk = (v: unknown, key: string, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 6) return;
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${key}[${i}]`, depth + 1)); return; }
    const o = v as Record<string, unknown>;
    const c = creditOf(o, lock, key);
    if (c) { out.push(c); return; }
    for (const [k, x] of Object.entries(o)) if (!SKIP_KEYS.has(k)) walk(x, k, depth + 1);
  };
  walk(json, '', 0);
  return out;
}

/**
 * All credits of several lock files, one line per asset: the same page listed twice (a model and its texture files, or two locks naming one
 * source) is kept once. CC BY first (the ones the licence requires), then the rest, each by title.
 */
export function mergeCredits(locks: { path: string; json: unknown }[]): Credit[] {
  const seen = new Map<string, Credit>();
  for (const l of locks) for (const c of creditsFromLock(l.json, l.path)) {
    const k = `${c.url.replace(/[?#].*$/, '').replace(/\/$/, '')}`;
    if (!seen.has(k)) seen.set(k, c);
  }
  const rank = (c: Credit): number => (isAttribution(c.licence) ? 0 : 1);
  return [...seen.values()].sort((a, b) => rank(a) - rank(b) || a.title.localeCompare(b.title));
}

/** One line of the credits panel, as the CC BY licence asks: title, author, source, licence. */
export function creditLine(c: Credit): string {
  return `"${c.title}" by ${c.author}, ${c.url}, ${c.licence}`;
}

/**
 * The public paths of every lock file in the build. Found at build time by a glob over public/look, so a lock that another fetch script adds
 * (a clubhouse or outdoor pack) is credited without anyone editing this list; the files themselves are fetched when the panel opens.
 */
export function lockPaths(): string[] {
  let keys: string[] = [];
  try {
    keys = Object.keys(import.meta.glob('/public/look/**/*.lock.json', { query: '?url', import: 'default' }));
  } catch { keys = []; }
  const known = ['/public/look/home/home.lock.json', '/public/look/gym/gym.lock.json', '/public/look/outdoor/sources.lock.json', '/public/look/models/models.lock.json'];
  return [...new Set([...keys, ...known])].map((k) => k.replace(/^\/public/, '')).sort();
}

/** Fetches every lock file (a missing or broken one is skipped) and returns the merged credits. */
export async function loadCredits(fetcher: (url: string) => Promise<unknown> = defaultFetch, paths: string[] = lockPaths()): Promise<Credit[]> {
  const got = await Promise.all(paths.map(async (p) => {
    try { return { path: p, json: await fetcher(p) }; } catch { return null; }
  }));
  return mergeCredits(got.filter((g): g is { path: string; json: unknown } => !!g && g.json !== null));
}

async function defaultFetch(url: string): Promise<unknown> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) return null;
  const text = await res.text();
  // a dev server answers a missing file with its index page: that is not a lock
  try { return JSON.parse(text) as unknown; } catch { return null; }
}
