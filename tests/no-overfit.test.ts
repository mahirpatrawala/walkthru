// C12a anti-overfit lint (SPEC 17.1 and 17.12 item 1). Always runs. No code path may name a scene, a project, a firm or a person,
// and no string unique to the one real drawing may sit in the repo. The private part of the check, the list of names taken from
// real samples, lives outside the repo in ~/walkthru-tools/eval/denylist.txt and is applied when the file is present.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allLexiconWords } from '../src/understand/lexicon';

const ROOT = path.resolve(__dirname, '..');
const walk = (dir: string, exts: string[], out: string[] = []): string[] => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'vendor' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};
const rel = (p: string): string => path.relative(ROOT, p);
const read = (p: string): string => fs.readFileSync(p, 'utf8');

const SRC = [...walk(path.join(ROOT, 'src'), ['.ts', '.tsx', '.css', '.json']), ...walk(path.join(ROOT, 'scripts'), ['.ts', '.json'])];
const isLocalOrLint = (p: string): boolean => p.endsWith('.local.test.ts') || p.endsWith('no-overfit.test.ts');
const TESTS = walk(path.join(ROOT, 'tests'), ['.ts', '.json']).filter((p) => !isLocalOrLint(p));
const SHIPPED = [...walk(path.join(ROOT, 'public', 'scenes'), ['.json']), ...['index.html', 'editor.html', 'engine-demo.html', 'vite.config.ts', 'vitest.config.ts'].map((f) => path.join(ROOT, f)).filter((p) => fs.existsSync(p))];

const scenes = fs.readdirSync(path.join(ROOT, 'public', 'scenes'), { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('test-')).map((e) => e.name);

const SCENE_COMPARE = /\b(?:sceneId|sceneName|scene|sceneSlug)\b\s*[!=]==?\s*['"`]|['"`]\s*[!=]==?\s*\b(?:sceneId|sceneName|scene|sceneSlug)\b/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/;
const PHONE = /(?<![\d.])[6-9]\d{9}(?![\d.])/;
const TITLE_BLOCK = /\b(?:Binder\d+|[A-Z]{2}-\d{4}|CHECKED BY\s+DATE|DRAWN BY\s+SCALE)\b/;

const denylistPath = path.join(os.homedir(), 'walkthru-tools', 'eval', 'denylist.txt');
const denylist = fs.existsSync(denylistPath)
  ? read(denylistPath).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).map((l) => l.toLowerCase())
  : [];

describe('anti-overfit lint (SPEC 17.12 item 1)', () => {
  it('scans a sensible number of files', () => {
    expect(SRC.length).toBeGreaterThan(50);
    expect(TESTS.length).toBeGreaterThan(20);
    expect(SHIPPED.length).toBeGreaterThan(3);
  });

  it('no scene folder name (other than test-*) appears in src/, scripts/ or the always-run tests', () => {
    expect(scenes.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of [...SRC, ...TESTS]) {
      const text = read(f);
      for (const s of scenes) if (text.includes(s)) hits.push(`${rel(f)} names the scene "${s}"`);
    }
    expect(hits).toEqual([]);
  });

  it('no scene id is compared with a string literal', () => {
    const hits = SRC.filter((f) => SCENE_COMPARE.test(read(f))).map(rel);
    expect(hits).toEqual([]);
  });

  it('the lint itself catches planted violations', () => {
    expect(SCENE_COMPARE.test("if (sceneId === 'abc') return;")).toBe(true);
    expect(SCENE_COMPARE.test('if ("abc" !== scene) return;')).toBe(true);
    expect(SCENE_COMPARE.test('const sceneId = params.get("scene");')).toBe(false);
    expect(EMAIL.test('write to someone@example.com')).toBe(true);
    expect(PHONE.test('call 9876543210 now')).toBe(true);
    expect(PHONE.test('scale 31.7123456789')).toBe(false);
    expect(TITLE_BLOCK.test('SHEET QZ-0042')).toBe(true);
    expect(TITLE_BLOCK.test('a sheet')).toBe(false);
  });

  it('the old hard-coded room regexes are gone', () => {
    const hits: string[] = [];
    for (const f of SRC) {
      const text = read(f);
      for (const name of ['BEDROOM_RE', 'ROOM_RE', 'ROOM_WORDS']) if (new RegExp(`\\b${name}\\b`).test(text)) hits.push(`${rel(f)} still has ${name}`);
    }
    expect(hits).toEqual([]);
  });

  it('lexicon words are lower case, at most 3 tokens, and none is on the private denylist', () => {
    const words = allLexiconWords();
    expect(words.length).toBeGreaterThan(200);
    for (const w of words) {
      expect(w, `"${w}" must be lower case`).toBe(w.toLowerCase());
      expect(w.trim().split(/\s+/).length, `"${w}" has more than 3 tokens`).toBeLessThanOrEqual(3);
      for (const bad of denylist) expect(w.toLowerCase().includes(bad), `lexicon word "${w}" matches a denylist entry`).toBe(false);
    }
  });

  it('no email address, phone number or title-block style string of a real drawing is in any file', () => {
    const hits: string[] = [];
    for (const f of [...SRC, ...TESTS, ...SHIPPED]) {
      const text = read(f);
      if (EMAIL.test(text)) hits.push(`${rel(f)}: an email address`);
      if (PHONE.test(text)) hits.push(`${rel(f)}: a phone-like number`);
      if (TITLE_BLOCK.test(text)) hits.push(`${rel(f)}: a title-block string`);
    }
    expect(hits).toEqual([]);
  });

  it('nothing on the private denylist (firms, projects, people, title-block text from real samples) is in any file', () => {
    if (!denylist.length) { console.log(`(no denylist at ${denylistPath}: the private half of this check was skipped)`); return; }
    const hits: string[] = [];
    for (const f of [...SRC, ...TESTS, ...SHIPPED]) {
      const text = read(f).toLowerCase();
      for (const bad of denylist) if (text.includes(bad)) hits.push(`${rel(f)} contains a denylist entry`);
    }
    expect(hits).toEqual([]);
  });

  it('the denylist, when present, is outside the repo and non-trivial', () => {
    if (!denylist.length) return;
    expect(path.relative(ROOT, denylistPath).startsWith('..')).toBe(true);
    expect(denylist.length).toBeGreaterThan(3);
  });
});
