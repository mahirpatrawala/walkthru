// C8. SPEC 13.5 step 2: text grouping and label parsing. Pure TypeScript.
import type { Px, RoomType } from '../types';
import { parseSize, parseLength } from '../core/units';
import type { VText } from './types';

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
export type FurnitureKey = 'bed' | 'sofa' | 'dining' | 'wardrobe' | 'study' | 'desk' | 'side table' | 'tv unit';
export interface FurnitureLabel {
  kind: 'furniture'; block: LabelBlock; key: FurnitureKey; name: string;
  dims?: { w: number; l: number }; runningLengthM?: number; centre: Px; angle: number;
}

const FT = "(?:\\d+(?:\\.\\d+)?\\s*'\\s*(?:\\d+(?:\\.\\d+)?\\s*\")?|\\d+(?:\\.\\d+)?\\s*\"|\\d+(?:\\.\\d+)?\\s*(?:mm|cm|m)?)";
const SIZE_RE = new RegExp(`(${FT})\\s*[xX×]\\s*(${FT})`);
const AREA_FT_RE = /(\d+(?:\.\d+)?)\s*(SQ\.?\s*FT|SQFT|SFT)/i;
const AREA_M_RE = /(\d+(?:\.\d+)?)\s*SQ\.?\s*M\b/i;
const SQFT_M2 = 0.09290304;

const wrap = (d: number): number => { let a = ((d % 360) + 360) % 360; if (a > 180) a -= 360; return a; };

function frame(angleDeg: number): { u: Px; down: Px } {
  const r = (angleDeg * Math.PI) / 180;
  return { u: { x: Math.cos(r), y: Math.sin(r) }, down: { x: -Math.sin(r), y: Math.cos(r) } };
}

interface Run { t: VText; s0: number; s1: number; c0: number; c1: number; cb: number; size: number; isSize: boolean }

function isSizeToken(str: string): boolean {
  const s = str.trim();
  if (!s) return false;
  const m = s.match(SIZE_RE);
  if (m && s.replace(m[0], '').trim() === '') return true;
  const a = s.match(AREA_FT_RE) ?? s.match(AREA_M_RE);
  return !!a && s.replace(a[0], '').trim() === '';
}

/** Group text runs into blocks: same angle, stacked lines, and a size or area line ends the block unless more size lines follow. */
export function groupTextBlocks(texts: VText[]): LabelBlock[] {
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

// ---------------------------------------------------------------- parsing

const FURN: { key: FurnitureKey; re: RegExp }[] = [
  { key: 'dining', re: /^DINING\s*TABLE\b/i },
  { key: 'side table', re: /^SIDE\s*TABLE\b/i },
  { key: 'tv unit', re: /^TV\s*UNIT\b/i },
  { key: 'wardrobe', re: /^WARDROBE\b/i },
  { key: 'bed', re: /^BED(?!\s*ROOM|ROOM)\b/i },
  { key: 'sofa', re: /^SOFA\b/i },
  { key: 'study', re: /^STUDY(?!\s*ROOM)\b/i },
  { key: 'desk', re: /^DESK\b/i },
];

const ROOM_RE = /\b(ROOM|BEDROOM|BED\s+ROOM|MASTER|LIVING|HALL|DRAWING|DINING|KITCHEN|TOILET|BATH|WC|WASH|BALCONY|TERRACE|UTILITY|PASSAGE|LOBBY|FOYER|POOJA|PUJA|STORE)\b/i;
// SPEC-GAP: 13.5 maps "bedroom words" to bedroom but only names BEDROOM, BED ROOM and MASTER. The reference drawing's
// room is "SON ROOM" and its test expects `bedroom`, so a family word before ROOM also counts.
const BEDROOM_RE = /\b(BEDROOM|BED\s+ROOM|MASTER|SON|DAUGHTER|KIDS?|CHILDREN|CHILD|GUEST|PARENTS?)\b/i;

export function roomTypeOf(name: string): RoomType {
  if (BEDROOM_RE.test(name)) return 'bedroom';
  if (/\b(LIVING|HALL|DRAWING|DINING)\b/i.test(name)) return 'living';
  if (/\bKITCHEN\b/i.test(name)) return 'kitchen';
  if (/\b(TOILET|BATH|WC|WASH)\b/i.test(name)) return 'bathroom';
  if (/\b(BALCONY|TERRACE|UTILITY)\b/i.test(name)) return 'balcony';
  return 'other';
}

export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-(])([a-z])/g, (_, a: string, b: string) => a + b.toUpperCase());
}

function sizeOf(text: string): { w: number; l: number } | undefined {
  const m = text.match(SIZE_RE);
  if (!m) return undefined;
  return parseSize(`${m[1].replace(/\s+/g, '')} x ${m[2].replace(/\s+/g, '')}`) ?? undefined;
}
function areaOf(text: string): number | undefined {
  const f = text.match(AREA_FT_RE);
  if (f) return parseFloat(f[1]) * SQFT_M2;
  const m = text.match(AREA_M_RE);
  if (m) return parseFloat(m[1]);
  return undefined;
}

export function parseBlock(block: LabelBlock): RoomLabel | FurnitureLabel | null {
  const nameLines: string[] = []; let dims: { w: number; l: number } | undefined; let area: number | undefined; let running: number | undefined;
  for (const ln of block.lines) {
    const rft = ln.text.match(/(\d+(?:\.\d+)?\s*'\s*(?:\d+(?:\.\d+)?\s*")?)\s*RFT\b/i);
    if (rft) running = parseLength(rft[1].replace(/\s+/g, '')) ?? undefined;
    const sz = isSizeToken(ln.text) ? sizeOf(ln.text) : undefined;
    const ar = isSizeToken(ln.text) ? areaOf(ln.text) : undefined;
    if (sz && !dims) dims = sz;
    else if (ar !== undefined && area === undefined && !sz) area = ar;
    else if (!isSizeToken(ln.text)) {
      // a name line, possibly with a trailing size ("BED 5'0"X6'0"")
      const s = sizeOf(ln.text);
      if (s && !dims) dims = s;
      nameLines.push(ln.text.replace(SIZE_RE, '').trim());
    }
  }
  const head = nameLines[0] ?? '';
  const full = nameLines.join(' ').replace(/\s+/g, ' ').trim();
  for (const f of FURN) {
    if (f.re.test(head)) {
      const name = f.key === 'wardrobe' ? 'Wardrobe' : titleCase(head.replace(/=.*$/, '').trim());
      return { kind: 'furniture', block, key: f.key, name, dims, runningLengthM: running, centre: block.centre, angle: block.angle };
    }
  }
  if (ROOM_RE.test(full)) {
    return { kind: 'room', block, name: titleCase(full), roomType: roomTypeOf(full), dims, areaM2: area, centre: block.centre };
  }
  return null;
}

export function parseLabels(texts: VText[]): { rooms: RoomLabel[]; furniture: FurnitureLabel[]; blocks: LabelBlock[] } {
  const blocks = groupTextBlocks(texts);
  const rooms: RoomLabel[] = []; const furniture: FurnitureLabel[] = [];
  for (const b of blocks) {
    const p = parseBlock(b);
    if (!p) continue;
    if (p.kind === 'room') rooms.push(p); else furniture.push(p);
  }
  return { rooms, furniture, blocks };
}
