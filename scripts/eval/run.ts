// C12a: run a pipeline over a list of sets and group the scores by variant, origin and split (SPEC 17.11).
import fs from 'node:fs';
import path from 'node:path';
import type { VectorPage } from '../../src/import/types';
import type { TruthLite } from './types';
import type { Pipeline } from './adapters';
import { addScores, newScore, scoreSet, summarise } from './score';
import type { FieldResult, SetScore } from './score';
import type { Variant } from './bars';

export interface EvalSet {
  id: string; split: 'dev' | 'held-out'; firm: string; origin: 'synthetic' | 'real';
  truth: TruthLite;
  vector?: () => Promise<VectorPage[]> | VectorPage[];
  raster?: { pageCount: number; width: number; height: number };
}
export interface Cell { variant: Variant; origin: 'synthetic' | 'real'; split: 'dev' | 'held-out'; score: SetScore; sets: number; seconds: number; errors: string[] }
export interface EvalReport { cells: Cell[]; perSet: { id: string; variant: Variant; origin: string; split: string; attempted: boolean; error?: string; seconds: number; aligned: boolean }[] }

export async function runEval(sets: EvalSet[], pipeline: Pipeline): Promise<EvalReport> {
  const cells = new Map<string, Cell>();
  const perSet: EvalReport['perSet'] = [];
  const cell = (variant: Variant, origin: 'synthetic' | 'real', split: 'dev' | 'held-out'): Cell => {
    const k = `${variant}|${origin}|${split}`;
    let c = cells.get(k);
    if (!c) { c = { variant, origin, split, score: newScore(), sets: 0, seconds: 0, errors: [] }; cells.set(k, c); }
    return c;
  };
  for (const s of sets) {
    for (const variant of ['vector', 'raster'] as const) {
      if (variant === 'vector' && !s.vector) continue;
      if (variant === 'raster' && !s.raster) continue;
      const t0 = Date.now();
      let pred;
      try {
        pred = variant === 'vector' ? await pipeline({ kind: 'vector', id: s.id, pages: await s.vector!() }) : await pipeline({ kind: 'raster', id: s.id, ...s.raster! });
      } catch (e) { pred = { attempted: false, error: `crash: ${(e as Error).message}` }; }
      const sc = scoreSet(pred, s.truth);
      const c = cell(variant, s.origin, s.split);
      addScores(c.score, sc);
      c.sets++; c.seconds += (Date.now() - t0) / 1000;
      if (pred.error && !c.errors.includes(pred.error)) c.errors.push(pred.error);
      perSet.push({ id: s.id, variant, origin: s.origin, split: s.split, attempted: pred.attempted, error: pred.error, seconds: (Date.now() - t0) / 1000, aligned: sc.aligned });
    }
  }
  return { cells: [...cells.values()], perSet };
}

export function merged(cells: Cell[], filter: (c: Cell) => boolean): SetScore {
  const t = newScore();
  for (const c of cells.filter(filter)) addScores(t, c.score);
  return t;
}

/** Plain-text report: one table per variant and origin, dev next to held-out, the bar, and a flag for a gap over 10 points. */
export function formatReport(rep: EvalReport, title: string): string {
  const out: string[] = [title, ''];
  for (const variant of ['vector', 'raster'] as const) for (const origin of ['synthetic', 'real'] as const) {
    const here = rep.cells.filter((c) => c.variant === variant && c.origin === origin);
    if (!here.length) continue;
    const nDev = here.filter((c) => c.split === 'dev').reduce((a, c) => a + c.sets, 0), nHeld = here.filter((c) => c.split === 'held-out').reduce((a, c) => a + c.sets, 0);
    const all = summarise(merged(here, () => true), variant);
    const dev = summarise(merged(here, (c) => c.split === 'dev'), variant);
    const held = summarise(merged(here, (c) => c.split === 'held-out'), variant);
    out.push(`${variant.toUpperCase()} sets, ${origin} (dev ${nDev}, held-out ${nHeld})`);
    if (all.every((a) => a.key === 'wrongVerified' || a.key === 'brokerShare' || a.detail.includes('of 0') || a.detail.endsWith('truth 0]') || a.detail.includes('truth 0'))) {
      out.push(`  no truth fields in these sets yet (add truth.json beside each drawing); they were run and only crashes are checked. ${here.reduce((a, c) => a + c.sets, 0)} set(s), errors: ${here.flatMap((c) => c.errors).join('; ') || 'none'}`, '');
      continue;
    }
    const pct = (r: number | null, max = false): string => (r === null ? 'n/a' : `${(r * 100).toFixed(max ? 1 : 0)}%`);
    out.push(`${'field'.padEnd(46)}${'all'.padStart(8)}${'dev'.padStart(8)}${'held-out'.padStart(10)}${'bar'.padStart(8)}  result`);
    all.forEach((a, i) => {
      const f = a; const d = dev[i], h = held[i];
      const isMax = a.key === 'wrongVerified' || a.key === 'brokerShare';
      const gap = d.rate !== null && h.rate !== null && Math.abs(d.rate - h.rate) > 0.1 && !isMax ? '  GAP>10pt' : '';
      const verdict = f.pass === null ? (f.bar === null ? 'n/a (no bar)' : 'no data') : f.pass ? 'meets bar' : f.notAttempted ? 'BELOW BAR (not attempted)' : 'BELOW BAR';
      const label = `${FIELD_LABEL[a.key]}`;
      out.push(`${label.padEnd(46)}${pct(f.rate, isMax && a.key === 'wrongVerified').padStart(8)}${pct(d.rate, isMax && a.key === 'wrongVerified').padStart(8)}${pct(h.rate, isMax && a.key === 'wrongVerified').padStart(10)}${(f.bar === null ? 'n/a' : (isMax ? '<=' : '>=') + (f.bar * 100).toFixed(isMax && a.key === 'wrongVerified' ? 1 : 0) + '%').padStart(8)}  ${verdict}${gap}   [${f.detail}]`);
    });
    out.push('');
  }
  const errs = new Map<string, number>();
  for (const p of rep.perSet) if (p.error) errs.set(`${p.variant}: ${p.error}`, (errs.get(`${p.variant}: ${p.error}`) ?? 0) + 1);
  if (errs.size) { out.push('Refusals and errors:'); for (const [k, v] of errs) out.push(`  ${v} x ${k}`); out.push(''); }
  const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  out.push(`Seconds per set: ${mean(rep.perSet.filter((p) => p.variant === 'vector').map((p) => p.seconds)).toFixed(2)} (vector), ${mean(rep.perSet.filter((p) => p.variant === 'raster').map((p) => p.seconds)).toFixed(2)} (raster)`);
  return out.join('\n');
}
import { FIELDS } from './bars';
const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));

/** The honesty bar: the wrong-verified rate over every cell, vector and raster. Null rate = no verified values at all. */
export function wrongVerified(rep: EvalReport): { n: number; wrong: number; rate: number | null } {
  const t = merged(rep.cells, () => true);
  return { n: t.verified.n, wrong: t.verified.wrong, rate: t.verified.n ? t.verified.wrong / t.verified.n : null };
}

// ---------------------------------------------------------------- real sets from a folder outside the repo
export interface FolderSet { dir: string; id: string }
/** Folder layout: <root>/<set>/{drawing.pdf | drawing.png | drawing.jpg}, truth.json, meta.json {split, firm}. */
export async function loadFolder(root: string): Promise<EvalSet[]> {
  if (!fs.existsSync(root)) return [];
  const sets: EvalSet[] = [];
  for (const name of fs.readdirSync(root).sort()) {
    const dir = path.join(root, name);
    if (!fs.statSync(dir).isDirectory()) continue;
    const metaP = path.join(dir, 'meta.json'), truthP = path.join(dir, 'truth.json');
    const meta = fs.existsSync(metaP) ? JSON.parse(fs.readFileSync(metaP, 'utf8')) : {};
    const truth: TruthLite = fs.existsSync(truthP) ? JSON.parse(fs.readFileSync(truthP, 'utf8')) : {};
    const split = meta.split === 'held-out' ? 'held-out' : 'dev';
    const set: EvalSet = { id: name, split, firm: String(meta.firm ?? name), origin: meta.synthetic ? 'synthetic' : 'real', truth };
    const pdf = path.join(dir, 'drawing.pdf');
    if (fs.existsSync(pdf)) {
      set.vector = async () => { const { loadVectorPages } = await import('../../src/import/pdfjs-adapter'); return loadVectorPages(new Uint8Array(fs.readFileSync(pdf))); };
    }
    const img = ['drawing.png', 'drawing.jpg', 'drawing.jpeg', 'raster-p1.png'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f));
    if (img) set.raster = { pageCount: 1, width: 1000, height: 1400 };
    if (set.vector || set.raster) sets.push(set);
  }
  return sets;
}
