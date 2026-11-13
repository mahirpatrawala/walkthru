// Reader sweep on the synthetic flats (SPEC 17.10, 17.19): every seed goes through the same upload job a broker upload runs
// (scripts/make-sample-homes.ts readSet), and the result is scored against the generator's truth, room by room.
//   tsx scripts/eval/sweep-reader.ts --seeds 1-120 --out /tmp/sweep-dev.jsonl     one JSON line per seed (resumable: seeds already in --out are skipped)
//   tsx scripts/eval/sweep-reader.ts --report a.jsonl [b.jsonl ...]               aggregate table (per BHK) over the files
// A flat is "fully right" when every drawn room is found with its type, its name (where the set labels rooms) and its area within 3%,
// nothing extra is invented, and validateLayout reports no error. No seed or scene is special-cased: the truth is the only input.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSet } from '../make-sample-homes';
import { validateLayout } from '../../src/core/layout-validate';
import { polygonArea } from '../../src/core/geometry';
import { alignRooms, apply } from './score';
import type { Pt } from './types';

export interface RoomRow { truth: string; kind: string; truthType: string; found: string | null; foundType: string | null; typeOk: boolean; nameOk: boolean | null; unnamed: boolean; areaRatio: number | null; verifiedWrong: boolean; verifiedN: number }
export interface SeedRow {
  seed: number; template: string; wall: string; text: string; units: string; labels: string;
  truthRooms: number; foundRooms: number; matched: number; extra: number;
  typeOk: number; nameOk: number; nameN: number; unnamed: number; area2: number; area3: number;
  openTruth: number; openFound: number; openHit: number;
  errors: string[]; warnings: number; verifiedN: number; verifiedWrong: number; fully: boolean;
  medianAreaRatio: number | null; rooms: RoomRow[]; failed?: string;
}
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const poly = (p: { x: number; z: number }[]): Pt[] => p.map((q) => [q.x, q.z] as Pt);
const areaOf = (p: Pt[]): number => Math.abs(polygonArea(p.map(([x, z]) => ({ x, z }))));
const median = (xs: number[]): number | null => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };

export async function scoreSeed(seed: number, scratch: string): Promise<SeedRow> {
  const r = await readSet(seed, `sweep-${seed}`, scratch);
  const o = r.truth.options;
  const base: SeedRow = { seed, template: o.template, wall: o.wallStyle, text: o.textMode, units: o.units, labels: o.labelStyle, truthRooms: r.truth.rooms.length, foundRooms: r.property.layout.rooms.length, matched: 0, extra: 0, typeOk: 0, nameOk: 0, nameN: 0, unnamed: 0, area2: 0, area3: 0, openTruth: r.truth.openings.length, openFound: r.property.layout.openings.length, openHit: 0, errors: [], warnings: 0, verifiedN: 0, verifiedWrong: 0, fully: false, medianAreaRatio: null, rooms: [] };
  const v = validateLayout(r.property.layout);
  base.errors = v.errors; base.warnings = v.warnings.length;
  const found = r.property.layout.rooms;
  const al = alignRooms(found.map((f) => ({ polygon: poly(f.polygon), roomType: f.roomType })), r.truth.rooms.map((t) => ({ polygonM: t.polygonM as Pt[], roomType: t.roomType })));
  // understanding.json for the statuses
  let doc: { rooms: { id: string; area: { status: string }; width: { status: string }; length: { status: string } }[] } | null = null;
  try { doc = JSON.parse(fs.readFileSync(path.join(scratch, 'root', '.cache', 'understand', `sweep-${seed}`, 'understanding.json'), 'utf8')); } catch { /* none */ }
  const used = new Set<number>();
  const ratios: number[] = [];
  const foundInTruth = found.map((f) => (al ? poly(f.polygon).map((p) => apply(al, p)) : poly(f.polygon)));
  // greedy by overlap with the aligned polygon, then by area
  const bbox = (p: Pt[]): [number, number, number, number] => [Math.min(...p.map((q) => q[0])), Math.min(...p.map((q) => q[1])), Math.max(...p.map((q) => q[0])), Math.max(...p.map((q) => q[1]))];
  const iou = (a: Pt[], b: Pt[]): number => { const A = bbox(a), B = bbox(b); const w = Math.min(A[2], B[2]) - Math.max(A[0], B[0]), h = Math.min(A[3], B[3]) - Math.max(A[1], B[1]); if (w <= 0 || h <= 0) return 0; const i = w * h; return i / ((A[2] - A[0]) * (A[3] - A[1]) + (B[2] - B[0]) * (B[3] - B[1]) - i); };
  const pairs: { t: number; f: number; s: number }[] = [];
  r.truth.rooms.forEach((t, ti) => foundInTruth.forEach((fp, fi) => { const s = iou(t.polygonM as Pt[], fp); if (s >= 0.3) pairs.push({ t: ti, f: fi, s }); }));
  pairs.sort((a, b) => b.s - a.s);
  const tMatch = new Map<number, number>();
  for (const p of pairs) if (!tMatch.has(p.t) && !used.has(p.f)) { tMatch.set(p.t, p.f); used.add(p.f); }
  r.truth.rooms.forEach((t, ti) => {
    const fi = tMatch.get(ti);
    if (fi === undefined) { base.rooms.push({ truth: t.labelString ?? t.kind, kind: t.kind, truthType: t.roomType, found: null, foundType: null, typeOk: false, nameOk: null, unnamed: false, areaRatio: null, verifiedWrong: false, verifiedN: 0 }); return; }
    const f = found[fi];
    base.matched++;
    const typeOk = f.roomType === t.roomType;
    const unnamed = /^room\s*\d*$/i.test(f.label ?? '') || !f.label;
    const nameOk = t.labelString ? key(f.label ?? '') === key(t.labelString) : null;
    const ratio = Math.abs(polygonArea(f.polygon)) / t.areaM2;
    ratios.push(ratio);
    if (typeOk) base.typeOk++;
    if (nameOk !== null) { base.nameN++; if (nameOk) base.nameOk++; }
    if (unnamed) base.unnamed++;
    if (Math.abs(ratio - 1) <= 0.02) base.area2++;
    if (Math.abs(ratio - 1) <= 0.03) base.area3++;
    let vN = 0, vWrong = false;
    const d = doc?.rooms.find((x) => x.id === f.id);
    if (d) for (const k of ['area', 'width', 'length'] as const) if (d[k].status === 'verified' || d[k].status === 'confirmed') { vN++; if (Math.abs(ratio - 1) > 0.03) vWrong = true; }
    base.verifiedN += vN > 0 ? 1 : 0; if (vWrong) base.verifiedWrong++;
    base.rooms.push({ truth: t.labelString ?? t.kind, kind: t.kind, truthType: t.roomType, found: f.label ?? f.id, foundType: f.roomType, typeOk, nameOk, unnamed, areaRatio: +ratio.toFixed(3), verifiedWrong: vWrong, verifiedN: vN });
  });
  base.extra = found.length - base.matched;
  base.medianAreaRatio = median(ratios);
  // openings: a found opening is placed on its room's edge, moved into the truth frame, and must sit within 0.6 m of a truth opening
  const usedT = new Set<number>();
  for (const op of r.property.layout.openings) {
    const room = found.find((x) => x.id === op.roomId);
    if (!room) continue;
    const a = room.polygon[op.edge], b = room.polygon[(op.edge + 1) % room.polygon.length];
    const L = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const p: Pt = [a.x + ((b.x - a.x) / L) * op.centreM, a.z + ((b.z - a.z) / L) * op.centreM];
    const q = al ? apply(al, p) : p;
    let bi = -1, bd = 0.6;
    r.truth.openings.forEach((t, i) => { if (usedT.has(i)) return; const d = Math.hypot(t.at.x - q[0], t.at.z - q[1]); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) { usedT.add(bi); base.openHit++; }
  }
  base.fully = isFully(base);
  return base;
}

/** Every drawn room found with its type, its name where the set names rooms, area within 3%; nothing extra; no validateLayout error. */
export function isFully(r: SeedRow): boolean {
  const unnamedWhereNamed = r.rooms.filter((x) => x.nameOk !== null && x.unnamed).length;
  return !r.failed && r.matched === r.truthRooms && r.extra === 0 && r.typeOk === r.matched && r.nameOk === r.nameN && unnamedWhereNamed === 0 && r.area3 === r.matched && r.errors.length === 0;
}

export function report(rows: SeedRow[], title: string): string {
  const out: string[] = [`== ${title}: ${rows.length} flats`];
  const groups: [string, (r: SeedRow) => boolean][] = [['all', () => true], ...['studio', '1bhk', '2bhk', '3bhk', 'single-bedroom'].map((t) => [t, (r: SeedRow) => r.template === t] as [string, (r: SeedRow) => boolean])];
  out.push('group            flats  fully  roomsFound  type%   name%  unnamedLbl area2%  area3%  openRecall  layoutErr(flats/total)  verifiedWrong');
  for (const [g, f] of groups) {
    const R = rows.filter((r) => !r.failed && f(r)); if (!R.length) continue;
    for (const r of R) r.fully = isFully(r);
    const s = (k: (r: SeedRow) => number): number => R.reduce((a, r) => a + k(r), 0);
    const pct = (a: number, b: number): string => (b ? (100 * a / b).toFixed(1) : '-').padStart(6);
    const errFlats = R.filter((r) => r.errors.length).length;
    out.push(`${g.padEnd(16)} ${String(R.length).padStart(5)}  ${String(R.filter((r) => r.fully).length).padStart(5)}  ${pct(s((r) => r.matched), s((r) => r.truthRooms))}   ${pct(s((r) => r.typeOk), s((r) => r.matched))} ${pct(s((r) => r.nameOk), s((r) => r.nameN))}  ${String(R.reduce((a, r) => a + r.rooms.filter((x) => x.nameOk !== null && x.unnamed).length, 0)).padStart(7)} ${pct(s((r) => r.area2), s((r) => r.matched))} ${pct(s((r) => r.area3), s((r) => r.matched))}  ${pct(s((r) => r.openHit), s((r) => r.openTruth))}      ${errFlats}/${s((r) => r.errors.length)}               ${s((r) => r.verifiedWrong)}/${s((r) => r.verifiedN)}`);
  }
  const fail = rows.filter((r) => r.failed); if (fail.length) out.push(`failed: ${fail.map((r) => r.seed).join(',')}`);
  return out.join('\n');
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const val = (k: string): string | undefined => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
  if (args.includes('--report')) {
    const files = args.slice(args.indexOf('--report') + 1);
    const rows: SeedRow[] = files.flatMap((f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SeedRow));
    console.log(report(rows, files.join(' ')));
    return;
  }
  const spec = val('--seeds') ?? '1-10';
  const seeds = spec.split(',').flatMap((p) => { const m = /^(\d+)-(\d+)$/.exec(p); return m ? Array.from({ length: +m[2] - +m[1] + 1 }, (_, i) => +m[1] + i) : [Number(p)]; });
  const out = val('--out') ?? path.join(os.tmpdir(), 'sweep.jsonl');
  const done = new Set<number>(fs.existsSync(out) ? fs.readFileSync(out, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as SeedRow).seed) : []);
  for (const seed of seeds) {
    if (done.has(seed)) continue;
    const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-sweep-'));
    let row: SeedRow;
    try { row = await scoreSeed(seed, scratch); }
    catch (e) { row = { seed, template: '?', wall: '', text: '', units: '', labels: '', truthRooms: 0, foundRooms: 0, matched: 0, extra: 0, typeOk: 0, nameOk: 0, nameN: 0, unnamed: 0, area2: 0, area3: 0, openTruth: 0, openFound: 0, openHit: 0, errors: [], warnings: 0, verifiedN: 0, verifiedWrong: 0, fully: false, medianAreaRatio: null, rooms: [], failed: (e as Error).message.slice(0, 200) }; }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
    fs.appendFileSync(out, JSON.stringify(row) + '\n');
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${path.resolve(process.argv[1])}`).href) main().catch((e) => { console.error(e); process.exit(1); });
