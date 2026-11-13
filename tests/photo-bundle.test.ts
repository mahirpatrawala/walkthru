// C12f acceptance (SPEC 17.14), the part that needs no build: nothing the browser loads can reach the key or the server code.
// (The built-bundle grep is `npm run check:photo-bundle` after `npx vite build`.)
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
function* walk(dir: string): Generator<string> {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (/\.(ts|css)$/.test(p)) yield p;
  }
}
const PHOTO_CLIENT = ['config.ts', 'geometry.ts', 'edges.ts', 'label.ts', 'mount.ts', 'session.ts', 'photo.css'].map((f) => path.join(root, 'src/photo', f));

describe('the key stays on the server', () => {
  it('no file under src/ outside src/photo/server and the dev plugin imports the photo server code', () => {
    const offenders: string[] = [];
    for (const f of walk(path.join(root, 'src'))) {
      if (f.includes(`${path.sep}photo${path.sep}server${path.sep}`)) continue;
      if (/photo\/server|\.\/server\/(handler|gemini|plugin)/.test(fs.readFileSync(f, 'utf8'))) offenders.push(path.relative(root, f));
    }
    expect(offenders).toEqual([]);
  });
  it('the client files never name the key, its env var, its file, the Gemini host or process.env', () => {
    for (const f of PHOTO_CLIENT) {
      const text = fs.readFileSync(f, 'utf8').replace(/^\s*(\/\/|\/\*|\*).*$/gm, ''); // comments may talk about it
      for (const bad of ['WALKTHRU_GEMINI_KEY', '.gemini-key', 'generativelanguage', 'x-goog-api-key', 'process.env', 'walkthru-tools']) {
        expect(text.includes(bad), `${path.basename(f)} mentions ${bad}`).toBe(false);
      }
    }
  });
  it('the buyer page reaches the feature only through the one mount call', () => {
    const main = fs.readFileSync(path.join(root, 'src/buyer/main.ts'), 'utf8');
    expect(main.match(/from '\.\.\/photo\/[^']+'/g)).toEqual(["from '../photo/mount'"]);
    expect(main.match(/mountAiPhoto\(/g)?.length).toBe(1);
  });
  it('the production function and the vite plugin are the only importers of the handler', () => {
    const api = fs.readFileSync(path.join(root, 'api/photo.ts'), 'utf8');
    expect(api).toContain('WALKTHRU_GEMINI_KEY');
    expect(api).toContain("from '../src/photo/server/handler.js'");
    const vite = fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8');
    expect(vite).toContain("from './src/photo/server/plugin'");
  });
});
