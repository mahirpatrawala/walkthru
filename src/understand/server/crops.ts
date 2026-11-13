// C12e. SPEC 17.9 "GET .../page/:n.png": crops of the page renders for the review step. Always read from .cache/understand/<scene>/pages,
// never from public/. The crop is a plain grey PNG of a rectangle of the render; the page draws the highlight over it, so the
// picture itself carries nothing but the drawing. Node only.
import fs from 'node:fs';
import path from 'node:path';
import type { Gray, Rect } from '../pixels/image';
import { cropGray, decodeImage, encodePng, resizeGray, rotateQuarter } from '../pixels/image';
import type { PageMeta, PagesFile } from '../page-geometry';
import type { UnderstandPaths } from './store';
import { readJson, sceneCache } from './store';

const MAX_CACHED = 3;
export class CropService {
  private cache = new Map<string, Gray>();
  constructor(private readonly paths: UnderstandPaths) {}

  meta(sceneId: string, n: number): PageMeta | null {
    const pf = readJson<PagesFile>(path.join(sceneCache(this.paths, sceneId), 'pages.json'));
    return pf?.pages.find((p) => p.n === n) ?? null;
  }
  private load(sceneId: string, m: PageMeta): Gray | null {
    // the file name is relative and comes from our own pages.json, but never trust a path: it must stay inside the scene's cache
    const dir = sceneCache(this.paths, sceneId);
    const full = path.resolve(dir, m.file);
    if (!full.startsWith(path.resolve(dir) + path.sep)) return null;
    let st: fs.Stats;
    try { st = fs.statSync(full); } catch { return null; }
    const key = `${full}:${st.mtimeMs}`;
    const hit = this.cache.get(key);
    if (hit) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const g = decodeImage(new Uint8Array(fs.readFileSync(full)));
    this.cache.set(key, g);
    while (this.cache.size > MAX_CACHED) this.cache.delete(this.cache.keys().next().value as string);
    return g;
  }
  /** A rectangle of a page, at most `maxW` wide (never magnified more than 2x). */
  crop(sceneId: string, n: number, rect: Rect, maxW = 640, turn: 0 | 90 | 180 | 270 = 0): Uint8Array | null {
    const m = this.meta(sceneId, n);
    if (!m) return null;
    const g = this.load(sceneId, m);
    if (!g) return null;
    const r: Rect = [Math.max(0, Math.min(g.width - 1, rect[0])), Math.max(0, Math.min(g.height - 1, rect[1])), Math.max(1, Math.min(g.width, rect[2])), Math.max(1, Math.min(g.height, rect[3]))];
    if (r[2] - r[0] < 2 || r[3] - r[1] < 2) return null;
    let c = cropGray(g, r);
    if (turn) c = rotateQuarter(c, turn).image;
    const w = Math.max(16, Math.min(Math.round(maxW), Math.round(c.width * 2)));
    if (c.width <= w) return encodePng(c);
    return encodePng(resizeGray(c, w, Math.max(1, Math.round((c.height * w) / c.width))).image);
  }
  page(sceneId: string, n: number, maxW = 1600, turn: 0 | 90 | 180 | 270 = 0): Uint8Array | null {
    const m = this.meta(sceneId, n);
    return m ? this.crop(sceneId, n, [0, 0, m.w, m.h], maxW, turn) : null;
  }
}
