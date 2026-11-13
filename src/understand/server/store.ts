// C12e. SPEC 17.6: where the review step keeps things. Everything about a drawing stays in .cache/understand/<scene>/ (the
// uploads, the page renders, understanding.json, review.json); only the three buyer-facing files go to public/scenes/<scene>/.
// Node only.
import fs from 'node:fs';
import path from 'node:path';
import type { PagesFile } from '../page-geometry';
import { applyReview } from '../review-apply';
import type { Applied, BaseOutputs } from '../review-apply';
import { emptyReview } from '../review-model';
import type { ReviewFile, UnderstandingDoc } from '../review-model';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;
export interface UnderstandPaths { root: string; scenesDir: string; cacheDir: string }
export function makePaths(root: string): UnderstandPaths {
  return { root, scenesDir: path.join(root, 'public/scenes'), cacheDir: path.join(root, '.cache/understand') };
}
export const sceneCache = (p: UnderstandPaths, id: string): string => path.join(p.cacheDir, id);
const file = (p: UnderstandPaths, id: string, name: string): string => path.join(sceneCache(p, id), name);

export function writeJsonAtomic(dest: string, value: unknown, pretty = false): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, pretty ? 2 : undefined) + (pretty ? '\n' : ''));
  fs.renameSync(tmp, dest);
}
export function readJson<T>(p: string): T | null {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) as T; } catch { return null; }
}

export interface Stored { doc: UnderstandingDoc; base: BaseOutputs; pages: PagesFile; review: ReviewFile }
export function hasUnderstanding(p: UnderstandPaths, id: string): boolean { return fs.existsSync(file(p, id, 'understanding.json')); }

export function loadStored(p: UnderstandPaths, id: string): Stored | null {
  const doc = readJson<UnderstandingDoc>(file(p, id, 'understanding.json'));
  const base = readJson<BaseOutputs>(file(p, id, 'base.json'));
  const pages = readJson<PagesFile>(file(p, id, 'pages.json'));
  if (!doc || !base || !pages) return null;
  const review = readJson<ReviewFile>(file(p, id, 'review.json')) ?? emptyReview();
  return { doc, base, pages, review };
}

export function saveStored(p: UnderstandPaths, id: string, s: Stored): void {
  writeJsonAtomic(file(p, id, 'understanding.json'), s.doc);
  writeJsonAtomic(file(p, id, 'base.json'), s.base);
  writeJsonAtomic(file(p, id, 'pages.json'), s.pages);
  writeJsonAtomic(file(p, id, 'review.json'), s.review);
}
export function saveReview(p: UnderstandPaths, id: string, r: ReviewFile): void { writeJsonAtomic(file(p, id, 'review.json'), r); }

/** SPEC 17.6 `write.ts`: regenerate proposal.json, proposal-extras.json and designs.json from the machine file and the decisions. */
export function writeOutputs(p: UnderstandPaths, id: string, s: Stored): Applied {
  const applied = applyReview(s.base, s.doc, s.review);
  const dir = path.join(p.scenesDir, id);
  writeJsonAtomic(path.join(dir, 'proposal.json'), applied.proposal, true);
  writeJsonAtomic(path.join(dir, 'proposal-extras.json'), applied.extras, true);
  writeJsonAtomic(path.join(dir, 'designs.json'), applied.designs, true);
  return applied;
}
