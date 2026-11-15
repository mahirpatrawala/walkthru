// What an uploaded home says about itself (SPEC 16.2 and 17.1). Nobody checked it, so it says so, lists what the reader could not read, and
// shows where the printed size and the drawn walls disagree. Pure text rules over proposal-extras.json: the same file the buyer page already
// reads for "not measured". No DOM, no Node.
import { ceilingTrustFromExtras } from '../core/room-trust';
import type { UnverifiedRooms } from '../core/room-trust';
import { fmtFtIn } from '../understand/review-model';

export { UPLOAD_TAG, SAMPLE_UPLOAD_TAG } from './tag';
import { UPLOAD_TAG, uploadTag } from './tag';
/** The tag for a home, by how many values the visitor checked. */
export const tagFor = (checkedByYou: number): string => (checkedByYou > 0 ? uploadTag(checkedByYou) : UPLOAD_TAG);

/** What is stored with an uploaded home and shown on its pages. */
export interface UploadNotes {
  /** "What we could not read" */
  unread: string[];
  /** printed size against drawn walls */
  conflicts: string[];
  /** values the visitor confirmed or corrected in "Check the drawing" */
  checkedByYou: number;
}

interface ExtrasLike {
  warnings?: unknown; ceiling?: unknown; units?: unknown;
  rooms?: { id?: string; label?: string; labelDims?: { w: number; l: number }; drawnDims?: { w: number; l: number }; verified?: boolean; note?: string; method?: string }[];
}

const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
const size = (d: { w: number; l: number }): string => `${fmtFtIn(Math.min(d.w, d.l))} x ${fmtFtIn(Math.max(d.w, d.l))} (${Math.min(d.w, d.l).toFixed(2)} x ${Math.max(d.w, d.l).toFixed(2)} m)`;

/** A reader warning in words for a visitor: the broker's "add one in the editor" has no meaning here. */
export function visitorWarning(w: string): string {
  let t = w.trim();
  const flats = /^This sheet holds (\d+) flats \(([^)]*)\)/.exec(t);
  if (flats) return `This sheet may show more than one flat (${flats[2]}). All of their rooms are in this home.`;
  t = t.replace(/\s*Add one in the editor\.?\s*$/i, '.').replace(/\s*Confirm it\.?\s*$/i, '').replace(/\s*in the editor\b/gi, '');
  return t.replace(/\.\.$/, '.');
}

/** Printed size against drawn walls, one line per room that disagrees. */
export function conflictLines(extras: ExtrasLike): string[] {
  const out: string[] = [];
  const warnings = (Array.isArray(extras.warnings) ? extras.warnings : []).filter(isStr);
  for (const r of extras.rooms ?? []) {
    const name = r.label ?? 'Room';
    if (r.labelDims && r.drawnDims) out.push(`${name}: printed ${size(r.labelDims)}, the walls drawn around it measure ${size(r.drawnDims)}. Nothing was picked silently: the room is shown as not measured.`);
    else if (r.note === 'drawing and label disagree') {
      // the reader already said both numbers in a warning of its own; use those words
      const w = warnings.find((x) => x.startsWith(`Room "${name}": label says`));
      out.push(w ? `${visitorWarning(w)} The room is shown as not measured.` : `${name}: the printed size ${r.labelDims ? size(r.labelDims) : ''} does not match the drawn walls. The room is shown as not measured.`.replace('size  does', 'size does'));
    }
  }
  return out;
}

/** The list under "What we could not read": reader warnings, rooms not measured, rooms partly off the sheet, the ceiling when it is a guess. */
export function unreadLines(extras: ExtrasLike, unverified: UnverifiedRooms, partial: { label: string; reason: string }[] = [], maxWarnings = 12): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string): void => { const k = s.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(s); } };
  // a good-news line ("5 of 5 rooms agree on one scale") is not something that could not be read
  const warnings = (Array.isArray(extras.warnings) ? extras.warnings : []).filter(isStr).filter((w) => !(/^Printed room sizes against the drawn walls:/.test(w) && /agree on one scale/.test(w) && !/disagree/.test(w))).map(visitorWarning);
  warnings.slice(0, maxWarnings).forEach(add);
  if (warnings.length > maxWarnings) add(`And ${warnings.length - maxWarnings} more notes from the reader.`);
  const label = new Map((extras.rooms ?? []).map((r) => [r.id, r.label ?? 'Room']));
  for (const [id, why] of Object.entries(unverified)) add(`${label.get(id) ?? 'A room'}: size not measured (${why}).`);
  for (const p of partial) add(`${p.label}: ${p.reason}`);
  if (!ceilingTrustFromExtras(extras).known) add('Ceiling height was not read from the drawing, so a standard height is used and shown as an assumption.');
  return out;
}

export function notesFor(extras: ExtrasLike, unverified: UnverifiedRooms, partial: { label: string; reason: string }[], checkedByYou = 0): UploadNotes {
  return { unread: unreadLines(extras, unverified, partial), conflicts: conflictLines(extras), checkedByYou };
}
