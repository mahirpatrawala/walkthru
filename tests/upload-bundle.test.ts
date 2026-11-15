// The browser reader must not need Node. Two checks: the import graph from the worker's source files never touches a Node built-in, and the BUILT
// worker chunks (a real `vite build` into a scratch folder) have no import of one. Also: the reader (pdf.js and the pipeline) is in worker chunks
// only, never in the start page's or the buyer page's own chunks, so it loads only on upload.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';

const root = path.resolve(import.meta.dirname, '..');
const BUILTINS = ['fs', 'path', 'crypto', 'os', 'child_process', 'url', 'util', 'zlib', 'stream', 'module', 'worker_threads', 'http', 'https', 'net', 'assert', 'buffer', 'events', 'process', 'perf_hooks', 'readline', 'tty', 'vm'];
/** One documented import, stubbed for the worker bundle by `browserShims` in vite.config.ts (the vector path never calls it). */
const STUBBED = new Set(['src/understand/pixels/image.ts imports node:zlib']);
const isBuiltin = (spec: string): boolean => spec.startsWith('node:') || BUILTINS.includes(spec.replace(/\/.*$/, ''));

function importsOf(src: string): string[] {
  const out: string[] = [];
  const re = /(?:^|[\s;(])(?:import|export)\s+(?:type\s+)?(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
function resolveTs(from: string, spec: string): string | null {
  const base = path.resolve(path.dirname(from), spec);
  for (const c of [`${base}.ts`, path.join(base, 'index.ts'), base]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  return null;
}

describe('the source graph of the browser reader', () => {
  const entries = ['src/upload/reader.worker.ts', 'src/upload/loader.ts', 'src/upload/read-core.ts'].map((f) => path.join(root, f));
  const seen = new Set<string>();
  const offenders: string[] = [];
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const spec of importsOf(src)) {
      if (isBuiltin(spec)) { offenders.push(`${path.relative(root, file)} imports ${spec}`); continue; }
      if (spec.startsWith('.')) { const r = resolveTs(file, spec); if (r && r.endsWith('.ts')) visit(r); }
    }
  };
  for (const e of entries) visit(e);

  it('reaches the reader pipeline, the pdf.js adapter and the review rules (so the check below means something)', () => {
    const rel = [...seen].map((f) => path.relative(root, f));
    for (const must of ['src/understand/pipeline.ts', 'src/understand/vector-adapter.ts', 'src/import/pdfjs-adapter.ts', 'src/understand/review-apply.ts', 'src/upload/home.ts']) expect(rel).toContain(must);
    expect(seen.size).toBeGreaterThan(60);
  });
  it('imports no Node built-in anywhere along the way, except the one the worker bundle stubs', () => {
    expect(offenders.filter((o) => !STUBBED.has(o))).toEqual([]);
    expect(fs.readFileSync(path.join(root, 'vite.config.ts'), 'utf8')).toContain("id === 'node:zlib'");
  });
  it('does not reach the Node-only server job or the picture readers', () => {
    const rel = [...seen].map((f) => path.relative(root, f));
    expect(rel.filter((f) => /understand\/server\/|understand\/raster|understand\/ocr|understand\/vision\//.test(f))).toEqual([]);
  });
});

describe('the built chunks', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'walkthru-upload-bundle-'));
  const assets = path.join(out, 'assets');
  const closure = new Set<string>();
  const files = (): string[] => fs.readdirSync(assets).filter((f) => f.endsWith('.js'));
  const read = (f: string): string => fs.readFileSync(path.join(assets, f), 'utf8');

  it('builds', async () => {
    await build({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'silent', build: { outDir: out, emptyOutDir: true } });
    expect(files().some((f) => f.startsWith('reader.worker-'))).toBe(true);
    // the worker chunk and everything it imports, statically or lazily
    const todo = files().filter((f) => f.startsWith('reader.worker-'));
    while (todo.length) {
      const f = todo.pop()!;
      if (closure.has(f)) continue;
      closure.add(f);
      for (const m of read(f).matchAll(/(?:from|import\()\s*[`"']\.\/([^`"']+\.js)[`"']/g)) if (fs.existsSync(path.join(assets, m[1]))) todo.push(m[1]);
    }
    expect(closure.size).toBeGreaterThan(2);
  }, 120_000);

  it('no worker chunk imports a Node built-in (pdf.js’s own Node branches only name them behind a runtime check, never import them)', () => {
    const bad: string[] = [];
    for (const f of closure) {
      const t = read(f);
      for (const m of t.matchAll(/(?:from|import\(|require\()\s*[`"']([^`"']+)[`"']/g)) if (isBuiltin(m[1])) bad.push(`${f}: ${m[0]}`);
      // a static `node:` specifier anywhere is a bundler leaving a Node import in
      if (/[`"']node:(fs|path|crypto|os|url|module|stream|child_process|util|zlib)[`"']/.test(t)) bad.push(`${f}: a node: specifier`);
    }
    expect(bad).toEqual([]);
  });

  it('no eval and no new Function in the reader or in pdf.js (nothing is run from a string)', () => {
    const bad: string[] = [];
    for (const f of closure) {
      const t = read(f);
      if (/(^|[^\w$.])eval\s*\(/.test(t)) bad.push(`${f}: eval(`);
      if (/new\s+Function\s*\(/.test(t)) bad.push(`${f}: new Function(`);
    }
    expect(bad).toEqual([]);
  });

  it('pdf.js and the reader pipeline are in the worker’s chunks only, never in the start page or the buyer page', () => {
    const page = files().filter((f) => /^(index|start|main|check|flow|card|honesty|store|local-fetch|notes-panel|local-index)-/.test(f));
    expect(page.length).toBeGreaterThan(3);
    for (const f of page) {
      const t = read(f);
      expect(t.includes('getOperatorList'), `${f} holds pdf.js`).toBe(false);
      // strings only the reader's own modules carry: the pdf.js adapter's shape check and the elevation reader's question
      expect(t.includes('pdf.js shape changed') || t.includes('Which wall does'), `${f} holds the reader`).toBe(false);
    }
    expect([...closure].some((f) => read(f).includes('getOperatorList'))).toBe(true);
    expect([...closure].some((f) => read(f).includes('Which wall does'))).toBe(true);
  });

  it('ships the sample plan beside the page', () => {
    expect(fs.existsSync(path.join(out, 'upload', 'sample-plan.pdf'))).toBe(true);
  });

  it('reports the sizes of the lazy chunks (printed, for the record)', () => {
    const sizes = [...closure].map((f) => `${f.replace(/-[\w-]{8}\.js$/, '')} ${(fs.statSync(path.join(assets, f)).size / 1024).toFixed(0)} KB`);
    console.log(`[upload chunks] ${sizes.join(' | ')}`);
    expect(sizes.length).toBeGreaterThan(0);
  });
});
