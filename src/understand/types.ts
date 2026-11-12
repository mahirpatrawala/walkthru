// C12a. SPEC 17.1 and 17.6: the status vocabulary and the shapes every extracted value carries. C12b to C12e fill these in;
// the scoring harness already reads `Status`.
export type Method = 'pdf-text' | 'glyph' | 'ocr' | 'vision' | 'vector' | 'derived' | 'broker';
export type Status = 'verified' | 'confirmed' | 'corrected' | 'unverified' | 'conflict';
export interface SourceRef { page: number; view: string; sheet: string; /** page units, y down */ bbox: [number, number, number, number]; text?: string }
export interface Check { kind: 'geometry' | 'chain' | 'cross-sheet' | 'label-area'; expected: number; got: number; ok: boolean }
export interface Extracted<T> {
  id: string;
  value: T; unit?: 'm' | 'm2' | 'deg' | 'count';
  method: Method; status: Status; confidence: number;
  source: SourceRef; alternatives?: { value: T; method: Method; source: SourceRef }[];
  checks: Check[];
  derivedFrom?: { ids: string[]; how: string };
}
/** May the buyer see this value as a fact? (SPEC 17.1 table) */
export const isFact = (s: Status): boolean => s === 'verified' || s === 'confirmed' || s === 'corrected';
