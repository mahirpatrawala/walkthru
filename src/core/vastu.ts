// The Vastu checklist (SPEC 22.2): a table of traditional placement rules read against a flat once north is known. Pure.
//
// What it is: traditional guidance, listed plainly. What it is not: a score, a verdict or a promise about anything. Each rule answers one of
//   'match'        the flat has what the rule is about and it stands where the rule prefers,
//   'mismatch'     it has it and it does not,
//   'not-checked'  the flat lacks that room, the room's kind is not known, or (bed head) no bed is placed.
// A not-checked rule is never a miss. The only number shown is how many rules match.
import { pointInPolygon } from './geometry';
import { facingOf } from './north';
import type { Dir8, NorthRef } from './north';
import { readFacing } from './facing';
import type { FacingReading, RoomReading, Zone } from './facing';
import type { FurnitureItem, Layout, RoomTag } from '../types';

export type Verdict = 'match' | 'mismatch' | 'not-checked';

export interface RuleResult {
  id: RuleId;
  /** the rule as the checklist words it: "Kitchen in the south-east" */
  title: string;
  verdict: Verdict;
  /** one plain line: what was found, and what the rule prefers when it does not match */
  detail: string;
}

export type RuleId = 'main-door' | 'kitchen' | 'master-bedroom' | 'pooja' | 'toilets' | 'bed-head' | 'living' | 'balcony';

export interface VastuReport {
  results: RuleResult[];
  /** how many rules match, out of `total` (every rule in the table, checked or not) */
  matches: number;
  total: number;
  mismatches: RuleResult[];
  notChecked: RuleResult[];
}

export const VASTU_NOTE = 'Traditional Vastu guidance, listed as a checklist. It is not advice about luck or outcomes, and a flat is never scored.';

// ---------------------------------------------------------------- what a room is

export type VastuKind = 'master-bedroom' | 'bedroom' | 'kitchen' | 'toilet' | 'pooja' | 'living' | 'dining' | 'balcony' | 'other';

/** The kind of a room by its label first (the drawing's own word), then its type. 'other' is a room the table has no rule for. */
export function vastuKind(r: Pick<RoomTag, 'label' | 'roomType'>): VastuKind {
  const l = r.label.toLowerCase();
  if (/\b(pooja|puja|mandir|prayer|temple)\b/.test(l)) return 'pooja';
  if (r.roomType === 'balcony' || /\b(balcon(y|ies)|deck|terrace)\b/.test(l)) return 'balcony';
  if (r.roomType === 'bathroom' || /\b(toilet|wc|washroom|bath(room)?|powder)\b/.test(l)) return 'toilet';
  if (r.roomType === 'kitchen' || /\bkitchen\b/.test(l)) return 'kitchen';
  if (r.roomType === 'bedroom' && /\bmaster\b/.test(l)) return 'master-bedroom';
  if (r.roomType === 'bedroom' && !/\b(servant|maid|staff)\b/.test(l)) return 'bedroom';
  if (/\bdining\b/.test(l)) return 'dining';
  if (r.roomType === 'living' || /\b(living|drawing|lounge)\b/.test(l)) return 'living';
  return 'other';
}

// ---------------------------------------------------------------- the table

/** The directions a rule prefers. The table is the whole policy: change a row here and nothing else. */
export const PREFERRED = {
  mainDoor: ['N', 'NE', 'E'],
  kitchen: ['SE'],
  masterBedroom: ['SW'],
  pooja: ['NE'],
  /** a toilet must NOT stand in these (the middle is the zone 'C') */
  toiletAvoid: ['NE', 'C'],
  /** bed head to the south or the east; the diagonal between them is within that quarter */
  bedHead: ['S', 'SE', 'E'],
  living: ['N', 'NE', 'E'],
  balcony: ['N', 'NE', 'E'],
} as const satisfies Record<string, readonly (Dir8 | 'C')[]>;

const WORD: Record<Zone, string> = { N: 'north', NE: 'north-east', E: 'east', SE: 'south-east', S: 'south', SW: 'south-west', W: 'west', NW: 'north-west', C: 'the centre' };
const wordOf = (z: Zone): string => (z === 'C' ? 'the centre' : `the ${WORD[z]}`);
const list = (zs: readonly Zone[]): string => { const w = zs.map((z) => (z === 'C' ? 'centre' : WORD[z])); return w.length < 2 ? w.join('') : `${w.slice(0, -1).join(', ')} or ${w[w.length - 1]}`; };
const names = (rs: RoomReading[]): string => rs.map((r) => r.label).join(', ');

const ok = (id: RuleId, title: string, detail: string): RuleResult => ({ id, title, verdict: 'match', detail });
const miss = (id: RuleId, title: string, detail: string): RuleResult => ({ id, title, verdict: 'mismatch', detail });
const skip = (id: RuleId, title: string, detail: string): RuleResult => ({ id, title, verdict: 'not-checked', detail });

/** A bed's head end: its back is away from where it faces (a piece's front looks along (sin yaw, cos yaw), SPEC 3.1). */
export function bedHeadDir(north: NorthRef, item: FurnitureItem): Dir8 {
  const a = (item.box.yawDeg * Math.PI) / 180;
  return facingOf(north, { x: -Math.sin(a), z: -Math.cos(a) });
}

interface Ctx { layout: Layout; furniture: readonly FurnitureItem[]; north: NorthRef; reading: FacingReading; kinds: Map<string, VastuKind> }
const roomsOf = (c: Ctx, k: VastuKind): RoomReading[] => c.reading.rooms.filter((r) => c.kinds.get(r.roomId) === k);

/** One rule that asks "does every room of this kind stand in one of these zones?". */
function placed(id: RuleId, title: string, kind: VastuKind | VastuKind[], want: readonly Zone[], missing: string): (c: Ctx) => RuleResult {
  const kinds = Array.isArray(kind) ? kind : [kind];
  return (c) => {
    const rooms = kinds.flatMap((k) => roomsOf(c, k));
    if (rooms.length === 0) return skip(id, title, missing);
    const off = rooms.filter((r) => !want.includes(r.zone));
    if (off.length === 0) return ok(id, title, `${names(rooms)}: ${rooms.map((r) => wordOf(r.zone)).filter((v, i, a) => a.indexOf(v) === i).join(' and ')}.`);
    return miss(id, title, `${off.map((r) => `${r.label} is in ${wordOf(r.zone)}`).join('; ')}. The rule prefers ${list(want)}.`);
  };
}

interface Rule { id: RuleId; title: string; check(c: Ctx): RuleResult }

export const RULES: readonly Rule[] = [
  {
    id: 'main-door', title: 'Main door faces north, east or north-east',
    check: (c) => {
      const d = c.reading.mainDoor;
      if (!d) return skip('main-door', 'Main door faces north, east or north-east', 'No door to the outside was found on the drawing.');
      const t = 'Main door faces north, east or north-east';
      return (PREFERRED.mainDoor as readonly Dir8[]).includes(d.facing) ? ok('main-door', t, `The main door faces ${WORD[d.facing]}.`) : miss('main-door', t, `The main door faces ${WORD[d.facing]}. The rule prefers ${list(PREFERRED.mainDoor)}.`);
    },
  },
  { id: 'kitchen', title: 'Kitchen in the south-east', check: placed('kitchen', 'Kitchen in the south-east', 'kitchen', PREFERRED.kitchen, 'This flat has no room marked as a kitchen.') },
  { id: 'master-bedroom', title: 'Master bedroom in the south-west', check: placed('master-bedroom', 'Master bedroom in the south-west', 'master-bedroom', PREFERRED.masterBedroom, 'No room is named a master bedroom.') },
  { id: 'pooja', title: 'Pooja room in the north-east', check: placed('pooja', 'Pooja room in the north-east', 'pooja', PREFERRED.pooja, 'This flat has no pooja room.') },
  {
    id: 'toilets', title: 'No toilet in the north-east or the centre',
    check: (c) => {
      const t = 'No toilet in the north-east or the centre';
      const rooms = roomsOf(c, 'toilet');
      if (rooms.length === 0) return skip('toilets', t, 'This flat has no room marked as a toilet.');
      const bad = rooms.filter((r) => (PREFERRED.toiletAvoid as readonly Zone[]).includes(r.zone));
      return bad.length === 0 ? ok('toilets', t, `${rooms.length === 1 ? 'The toilet is' : `All ${rooms.length} toilets are`} outside those zones.`) : miss('toilets', t, `${bad.map((r) => `${r.label} is in ${wordOf(r.zone)}`).join('; ')}.`);
    },
  },
  {
    id: 'bed-head', title: 'Bed head to the south or the east',
    check: (c) => {
      const t = 'Bed head to the south or the east';
      const beds = c.furniture.filter((f) => f.kind === 'bed');
      if (beds.length === 0) return skip('bed-head', t, 'No bed is placed in this flat.');
      const dirs = beds.map((b) => ({ b, d: bedHeadDir(c.north, b) }));
      const bad = dirs.filter((x) => !(PREFERRED.bedHead as readonly Dir8[]).includes(x.d));
      const roomOf = (b: FurnitureItem): string | null => c.layout.rooms.find((r) => pointInPolygon({ x: b.box.cx, z: b.box.cz }, r.polygon))?.label ?? null;
      const where = (x: { b: FurnitureItem; d: Dir8 }): string => `${x.b.label}${roomOf(x.b) ? ` in ${roomOf(x.b)}` : ''}: head to the ${WORD[x.d]}`;
      return bad.length === 0 ? ok('bed-head', t, `${dirs.map(where).join('; ')}.`) : miss('bed-head', t, `${bad.map(where).join('; ')}. The rule prefers ${list(PREFERRED.bedHead)}.`);
    },
  },
  { id: 'living', title: 'Living room to the north or the east', check: placed('living', 'Living room to the north or the east', 'living', PREFERRED.living, 'No room is named a living room.') },
  { id: 'balcony', title: 'Balcony to the north or the east', check: placed('balcony', 'Balcony to the north or the east', 'balcony', PREFERRED.balcony, 'This flat has no balcony.') },
];

/**
 * Reads a flat against the table. `furniture` is what is placed now (a bed the buyer moved counts where it stands). Null when the layout has no rooms.
 * Callers show it only when north is set and the building's `vastu_enabled` is on (SPEC 22.3).
 */
export function vastuReport(layout: Layout, furniture: readonly FurnitureItem[], north: NorthRef): VastuReport | null {
  const reading = readFacing(layout, north);
  if (!reading) return null;
  const kinds = new Map(layout.rooms.map((r) => [r.id, vastuKind(r)] as const));
  const c: Ctx = { layout, furniture, north, reading, kinds };
  const results = RULES.map((r) => r.check(c));
  return {
    results,
    matches: results.filter((r) => r.verdict === 'match').length,
    total: results.length,
    mismatches: results.filter((r) => r.verdict === 'mismatch'),
    notChecked: results.filter((r) => r.verdict === 'not-checked'),
  };
}

/** "6 of 8 match" */
export const summaryLine = (r: VastuReport): string => `${r.matches} of ${r.total} match`;
