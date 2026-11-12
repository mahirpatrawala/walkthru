// Pure helpers for the `sources` of a designs.json entry: where a value was read, worded for a card. No three, no DOM.
import type { DesignSource } from './designs';

type Src = DesignSource | DesignSource[] | string | undefined;
const first = (src: Src): DesignSource | null => { const one = Array.isArray(src) ? src[0] : src; return one && typeof one === 'object' ? one : null; };

/** "page 4" for a value's source, or null when the design does not say (the first source when there are several). */
export function sourcePage(src: Src): string | null {
  const one = first(src);
  return one && typeof one.page === 'number' && Number.isFinite(one.page) ? `page ${one.page}` : null;
}
/** "elevation 3" for a source sheet named "ELEVATION-3", or null. */
export function sourceSheet(src: Src): string | null {
  const one = first(src);
  return one && typeof one.sheet === 'string' && one.sheet.trim() ? one.sheet.trim().replace(/[-_]+/g, ' ').toLowerCase() : null;
}
