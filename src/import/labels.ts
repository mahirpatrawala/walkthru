// C8. SPEC 13.5 step 2: text grouping and label parsing. Pure TypeScript.
import type { Px, RoomType } from '../types';
import type { VText } from './types';
import { findArea, findSize, hasRunningMarker, isSizeOnly, parseRunningLength, stripSize } from '../understand/units';
import { furnitureOf, isRoomLabel, roomTypeOf as lexRoomTypeOf } from '../understand/lexicon';

export interface LabelLine { text: string; runs: VText[] }
export interface LabelBlock {
  lines: LabelLine[];
  angle: number;
  /** centre of the block's ink box, page units */
  centre: Px;
  /** axis-aligned extent of the block, page units */
  bbox: [number, number, number, number];
  size: number;
}
export interface RoomLabel {
  kind: 'room'; block: LabelBlock; name: string; roomType: RoomType;
  dims?: { w: number; l: number }; areaM2?: number; centre: Px;
}
/** A furniture lexicon key (understand/lexicon/furniture.json): bed, sofa, wardrobe, side table, ... */
export type FurnitureKey = string;
export interface FurnitureLabel {
  kind: 'furniture'; block: LabelBlock; key: FurnitureKey; name: string;
  dims?: { w: number; l: number }; runningLengthM?: number; centre: Px; angle: number;
}

const wrap = (d: number): number => { let a = ((d % 360) + 360) % 360; if (a > 180) a -= 360; return a; };

function frame(angleDeg: number): { u: Px; down: Px } {
  const r = (angleDeg * Math.PI) / 180;
  return { u: { x: Math.cos(r), y: Math.sin(r) }, down: { x: -Math.sin(r), y: Math.cos(r) } };
}

interface Run { t: VText; s0: number; s1: number; c0: number; c1: number; cb: number; size: number; isSize: boolean }

const isSizeToken = isSizeOnly;

const NUM_RUN = /^\d{3,5}$|^\d+\.\d+$/;
/**
 * A size written over several runs: "3800" with "x4125" under it (or "3800 x" with "4125"). The x is the evidence that the two belong
 * together, so a lone dimension-line number near a label is never pulled in. Returns the runs with each such pair joined into one
 * "3800 x 4125" run (at the first run's position, as wide as the wider one).
 */
export function joinSizeFragments(texts: VText[]): VText[] {
  const used = new Set<number>(); const out: VText[] = [];
  const lead = (t: VText): boolean => NUM_RUN.test(t.str.trim()) || /^\d{3,5}\s*[x×]$|^\d+\.\d+\s*[x×]$/i.test(t.str.trim());
  const tail = (t: VText): boolean => /^[x×]\s*\d{3,5}$|^[x×]\s*\d+\.\d+$/i.test(t.str.trim());
  const tailNum = (t: VText): boolean => NUM_RUN.test(t.str.trim());
  texts.forEach((a, i) => {
    if (used.has(i) || !lead(a)) return;
    const wantTail = !/[x×]$/i.test(a.str.trim());
    let best = -1, bestD = Infinity;
    texts.forEach((b, j) => {
      if (j === i || used.has(j) || Math.abs(((b.angle - a.angle + 540) % 360) - 180) > 1) return;
      if (!(wantTail ? tail(b) : tailNum(b))) return;
      const k = Math.min(a.size, b.size);
      const dy = b.y - a.y, dx = Math.abs((b.x + b.width / 2) - (a.x + a.width / 2));
      // under it (about one line down) or beside it on the same baseline
      const stacked = dy > 0.5 * k && dy < 2.4 * k && dx < 1.6 * Math.max(a.width, b.width);
      const beside = Math.abs(dy) < 0.4 * k && b.x - (a.x + a.width) < 1.5 * k && b.x > a.x;
      if (!stacked && !beside) return;
      const d = Math.hypot(dx, dy); if (d < bestD) { bestD = d; best = j; }
    });
    if (best < 0) return;
    const b = texts[best]; used.add(i); used.add(best);
    const bs = b.str.trim().replace(/^[x×]\s*/i, '');
    out.push({ ...a, str: wantTail ? `${a.str.trim()} x ${bs}` : `${a.str.trim().replace(/\s*[x×]$/i, '')} x ${b.str.trim()}`, width: Math.max(a.width, b.width) });
  });
  texts.forEach((t, i) => { if (!used.has(i)) out.push(t); });
  return out;
}

/** Group text runs into blocks: same angle, stacked lines, and a size or area line ends the block unless more size lines follow. */
export function groupTextBlocks(textsIn: VText[]): LabelBlock[] {
  const texts = joinSizeFragments(textsIn);
  const runs: (Run & { ang: number })[] = [];
  for (const t of texts) {
    if (!t.str.trim()) continue;
    const ang = wrap(t.angle);
    const { u, down } = frame(ang);
    const s0 = t.x * u.x + t.y * u.y; const cb = t.x * down.x + t.y * down.y;
    runs.push({ t, ang, s0, s1: s0 + t.width, c0: cb - 0.75 * t.size, c1: cb + 0.2 * t.size, cb, size: t.size, isSize: isSizeToken(t.str) });
  }
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return parent[i]; };
  const sameAngle = (A: { ang: number }, B: { ang: number }): boolean => Math.abs(wrap(A.ang - B.ang)) <= 1;
  for (let j = 0; j < runs.length; j++) {
    const B = runs[j];
    // words on one baseline belong to one line
    for (let i = 0; i < runs.length; i++) {
      const A = runs[i];
      if (i === j || !sameAngle(A, B)) continue;
      const k = Math.min(A.size, B.size);
      if (Math.abs(A.cb - B.cb) > 0.3 * k) continue;
      if (Math.max(0, Math.max(A.s0, B.s0) - Math.min(A.s1, B.s1)) < 1.2 * k) parent[find(i)] = find(j);
    }
    // the line directly above: the nearest earlier line that overlaps or sits close along the reading direction
    let above = -1;
    for (let i = 0; i < runs.length; i++) {
      const A = runs[i];
      if (i === j || !sameAngle(A, B)) continue;
      const k = Math.min(A.size, B.size);
      if (B.cb <= A.cb + 0.3 * k) continue;
      if (Math.max(0, B.c0 - A.c1) >= 1.6 * k) continue;
      if (Math.max(0, Math.max(A.s0, B.s0) - Math.min(A.s1, B.s1)) >= 2 * k) continue;
      if (above < 0 || A.cb > runs[above].cb) above = i;
    }
    if (above < 0) continue;
    // a size or area line closes the label, unless another size or area line follows
    if (runs[above].isSize && !B.isSize) continue;
    parent[find(above)] = find(j);
  }
  const groups = new Map<number, (Run & { ang: number })[]>();
  runs.forEach((r, i) => { const g = groups.get(find(i)); if (g) g.push(r); else groups.set(find(i), [r]); });
  const blocks: LabelBlock[] = [];
  for (const g of groups.values()) {
    const ang = g[0].ang;
    const { u, down } = frame(ang);
    g.sort((a, b) => a.cb - b.cb || a.s0 - b.s0);
    // lines: runs on one baseline
    const lines: LabelLine[] = [];
    let cur: (Run & { ang: number })[] = [];
    const flush = (): void => {
      if (!cur.length) return;
      cur.sort((a, b) => a.s0 - b.s0);
      lines.push({ text: cur.map((r) => r.t.str.trim()).join(' ').replace(/\s+/g, ' '), runs: cur.map((r) => r.t) });
      cur = [];
    };
    for (const r of g) {
      if (cur.length && Math.abs(r.cb - cur[0].cb) > 0.4 * Math.min(r.size, cur[0].size)) flush();
      cur.push(r);
    }
    flush();
    const s0 = Math.min(...g.map((r) => r.s0)); const s1 = Math.max(...g.map((r) => r.s1));
    const c0 = Math.min(...g.map((r) => r.c0)); const c1 = Math.max(...g.map((r) => r.c1));
    const sm = (s0 + s1) / 2; const cm = (c0 + c1) / 2;
    const centre = { x: sm * u.x + cm * down.x, y: sm * u.y + cm * down.y };
    const corners = [[s0, c0], [s1, c0], [s1, c1], [s0, c1]].map(([s, c]) => ({ x: s * u.x + c * down.x, y: s * u.y + c * down.y }));
    const xs = corners.map((p) => p.x); const ys = corners.map((p) => p.y);
    blocks.push({ lines, angle: ang, centre, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], size: Math.max(...g.map((r) => r.size)) });
  }
  return blocks;
}

// ---------------------------------------------------------------- parsing (vocabulary lives in understand/lexicon)

export const roomTypeOf = (name: string): RoomType => lexRoomTypeOf(name);

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

export function parseBlock(block: LabelBlock): RoomLabel | FurnitureLabel | null {
  const nameLines: string[] = []; let dims: { w: number; l: number } | undefined; let area: number | undefined; let running: number | undefined;
  for (const ln of block.lines) {
    const rl = parseRunningLength(ln.text);
    if (rl) running = rl.m;
    const sizeOnly = isSizeToken(ln.text);
    const sz = sizeOnly ? findSize(ln.text) : null;
    const ar = sizeOnly ? findArea(ln.text) : null;
    if (sz && !dims) dims = { w: sz.w, l: sz.l };
    else if (ar && area === undefined && !sz) area = ar.m2;
    else if (!sizeOnly) {
      // a name line, possibly with a trailing size ("BED 5'0"X6'0"")
      // (a name can carry the size twice, in metres and in feet: every size goes out of the name, the first one is the label's)
      let nm = ln.text;
      for (let guard = 0; guard < 4; guard++) { const s = findSize(nm); if (!s) break; if (!dims) dims = { w: s.w, l: s.l }; nm = stripSize(nm); }
      nameLines.push(nm);
    }
  }
  const head = nameLines[0] ?? '';
  // dimension text never rides along in a room's name: a loose 3 to 5 digit number or a lone x left by a size split over lines
  const clean = (t: string): string => { const c = t.replace(/(^|\s)[x×]?\s*\d{3,5}(?=\s|$)/gi, ' ').replace(/(^|\s)[x×](?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim(); return c || t; };
  const full = clean(nameLines.join(' ').replace(/\s+/g, ' ').trim());
  const f = furnitureOf(head, !!dims);
  // a bed, study or dressing label with a room-sized size is the room, not the furniture ("BED 12'0"X10'0"" is not a 12 foot bed)
  const roomSized = !!dims && Math.min(dims.w, dims.l) >= 2.0 && Math.max(dims.w, dims.l) >= 2.4;
  if (f && !(roomSized && ['bed', 'study', 'dressing'].includes(f.entry.key))) {
    const key = f.entry.key;
    const name = f.entry.displayName ?? titleCase(head.replace(/=.*$/, '').trim());
    // an unsized, unmarked "WARDROBE" still carries its running length when a later line gave one
    return { kind: 'furniture', block, key, name, dims, runningLengthM: running, centre: block.centre, angle: block.angle };
  }
  if (isRoomLabel(full) && !(running !== undefined && hasRunningMarker(full))) {
    return { kind: 'room', block, name: titleCase(full), roomType: roomTypeOf(full), dims, areaM2: area, centre: block.centre };
  }
  return null;
}

/** A block of the given lines (all one reading angle), its ink box and centre worked out the way `groupTextBlocks` does. */
function blockOfLines(lines: LabelLine[], ang: number): LabelBlock {
  const { u, down } = frame(ang);
  const rs = lines.flatMap((l) => l.runs);
  const s0s = rs.map((t) => t.x * u.x + t.y * u.y), cbs = rs.map((t) => t.x * down.x + t.y * down.y);
  const s0 = Math.min(...s0s), s1 = Math.max(...rs.map((t, i) => s0s[i] + t.width));
  const c0 = Math.min(...rs.map((t, i) => cbs[i] - 0.75 * t.size)), c1 = Math.max(...rs.map((t, i) => cbs[i] + 0.2 * t.size));
  const sm = (s0 + s1) / 2, cm = (c0 + c1) / 2;
  const corners = [[s0, c0], [s1, c0], [s1, c1], [s0, c1]].map(([s, c]) => ({ x: s * u.x + c * down.x, y: s * u.y + c * down.y }));
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  return { lines, angle: ang, centre: { x: sm * u.x + cm * down.x, y: sm * u.y + cm * down.y }, bbox: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], size: Math.max(...rs.map((t) => t.size)) };
}

/** A line that is a furniture note with a length on it ("WARDROBE 6'0" RFT", "W/R 2.7M", "BED 6'0"X6'6"") or a lone key letter or number. */
function strayLine(text: string): 'furniture' | 'tag' | null {
  const t = text.trim();
  if (/^[A-Za-z0-9]$/.test(t)) return 'tag';
  if (isSizeToken(t) || !/\d/.test(t)) return null;
  return furnitureOf(t.replace(/[=:].*$/, '').replace(/\d.*$/, '').trim() || t, true) ? 'furniture' : null;
}

/**
 * A room's name block can pick up a line that is not part of it: a furniture note set between the name and the size ("BEDROOM",
 * "WARDROBE 6'0" RFT", "11'6"X12'0""), or the letter of an elevation key marker above the name. Left in, the note rides in the room's
 * name (or makes the label unreadable as a room). Such a line leaves the block when the rest still names a room; a furniture note
 * becomes a furniture label of its own, a lone key letter is dropped. Blocks with no room name in them are never touched.
 */
export function splitStray(block: LabelBlock): LabelBlock[] {
  if (block.lines.length < 2) return [block];
  const stray = block.lines.map((l) => strayLine(l.text));
  if (!stray.some(Boolean)) return [block];
  const keep = block.lines.filter((_, i) => !stray[i]);
  if (!keep.some((l) => !isSizeToken(l.text) && isRoomLabel(l.text))) return [block];
  const out: LabelBlock[] = [blockOfLines(keep, block.angle)];
  block.lines.forEach((l, i) => { if (stray[i] === 'furniture') out.push(blockOfLines([l], block.angle)); });
  return out;
}

export function parseLabels(texts: VText[]): { rooms: RoomLabel[]; furniture: FurnitureLabel[]; blocks: LabelBlock[] } {
  const blocks = groupTextBlocks(texts).flatMap(splitStray);
  const rooms: RoomLabel[] = []; const furniture: FurnitureLabel[] = [];
  for (const b of blocks) {
    const p = parseBlock(b);
    if (!p) continue;
    if (p.kind === 'room') rooms.push(p); else furniture.push(p);
  }
  return { rooms, furniture, blocks };
}
