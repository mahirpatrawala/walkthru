// The interface layer's pure rules: the screen scale, the idle and kiosk parameters, the share link, the Flats list, and a lint that keeps the chrome's
// sizes in the design tokens (no raw pixel sizes) so the walk and the pages scale together on a showroom wall.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { labelsFor, scaleFor } from '../src/brand/scale';
import { DEFAULT_ATTRACT_S, DEFAULT_HIDE_S, parsePresence } from '../src/buyer/presence';
import { buildShareUrl, parseShare, shareWalk } from '../src/buyer/share';
import { flatLevels, flatRow } from '../src/building/flats';
import { firstSentence } from '../src/building/map';
import { parseBuilding } from '../src/building/parse';

const root = path.join(__dirname, '..');

describe('the screen scale (tokens.css --wt-z)', () => {
  it('is 1 on a phone and a tablet, and grows with the short side up to 3', () => {
    expect(scaleFor(390, 844)).toBe(1);
    expect(scaleFor(1180, 820)).toBe(1);
    expect(scaleFor(1440, 900)).toBe(1.1);
    expect(scaleFor(1920, 1080)).toBe(1.3);
    expect(scaleFor(3840, 2160)).toBe(2.65);
    expect(scaleFor(7680, 4320)).toBe(3);
    expect(scaleFor(0, 0)).toBe(1);
  });
});

describe('how much text the chrome carries', () => {
  it('icons alone on a laptop and a tablet, the main tools named on a wall display, every tool named only when there is room', () => {
    expect(labelsFor(390, 844)).toBe('icons');
    expect(labelsFor(1180, 820)).toBe('icons');
    expect(labelsFor(1440, 900)).toBe('icons');
    expect(labelsFor(1920, 1080)).toBe('primary');
    expect(labelsFor(3840, 2160)).toBe('primary');
    expect(labelsFor(3440, 1440)).toBe('full');
  });
});

describe('presence: idle fade and attract mode parameters', () => {
  it('fades the chrome after a few seconds by default and never starts a tour on its own', () => {
    expect(parsePresence('')).toEqual({ kiosk: false, attractAfterS: null, hideAfterS: DEFAULT_HIDE_S });
  });
  it('kiosk=1 turns the attract mode on after 90 s, idle=<s> sets it, autohide=0 keeps the chrome', () => {
    expect(parsePresence('?kiosk=1').attractAfterS).toBe(DEFAULT_ATTRACT_S);
    expect(parsePresence('?kiosk=1').kiosk).toBe(true);
    expect(parsePresence('?idle=45').attractAfterS).toBe(45);
    expect(parsePresence('?idle=45').kiosk).toBe(false);
    expect(parsePresence('?kiosk=1&idle=120&autohide=0')).toEqual({ kiosk: true, attractAfterS: 120, hideAfterS: null });
    expect(parsePresence('?autohide=15').hideAfterS).toBe(15);
  });
  it('ignores nonsense', () => {
    expect(parsePresence('?idle=abc').attractAfterS).toBeNull();
    expect(parsePresence('?idle=2').attractAfterS).toBeNull();
    expect(parsePresence('?kiosk=1&idle=-5').attractAfterS).toBe(DEFAULT_ATTRACT_S);
    expect(parsePresence('?autohide=zzz').hideAfterS).toBe(DEFAULT_HIDE_S);
  });
});

describe('the share link', () => {
  const state = { href: 'http://localhost:5471/?building=sample-tower&space=f2-201&debug=1', at: { x: 3.456, z: 7.2, yawDeg: -90 }, cam: 'third' as const };
  it('keeps the place, adds the spot, the heading and the camera, and drops debug', () => {
    const u = new URL(buildShareUrl(state));
    expect(u.searchParams.get('building')).toBe('sample-tower');
    expect(u.searchParams.get('space')).toBe('f2-201');
    expect(u.searchParams.get('at')).toBe('3.46,7.2,270');
    expect(u.searchParams.get('cam')).toBe('third');
    expect(u.searchParams.has('debug')).toBe(false);
    expect(u.searchParams.has('view')).toBe(false);
  });
  it('writes the view mode when it is not Walk, and the layout code through the hook', () => {
    expect(new URL(buildShareUrl({ ...state, view: 'doll' })).searchParams.get('view')).toBe('doll');
    expect(new URL(buildShareUrl({ ...state, view: 'walk' })).searchParams.has('view')).toBe(false);
    expect(new URL(buildShareUrl({ ...state, withLayout: (h) => `${h}&my=abc` })).searchParams.get('my')).toBe('abc');
  });
  it('reads it back, and drops anything malformed or out of range', () => {
    expect(parseShare('?at=3.46,7.2,270&cam=first&view=plan')).toEqual({ at: { x: 3.46, z: 7.2, yawDeg: 270 }, cam: 'first', view: 'plan' });
    expect(parseShare('?at=3.46,7.2,-90').at?.yawDeg).toBe(270);
    expect(parseShare('?at=abc').at).toBeNull();
    expect(parseShare('?at=1,2').at).toBeNull();
    expect(parseShare('?at=99999,2,3').at).toBeNull();
    expect(parseShare('?cam=sideways&view=lava')).toEqual({ at: null, cam: null, view: null });
    expect(parseShare('')).toEqual({ at: null, cam: null, view: null });
  });
  it('uses the share sheet on a touch device, the clipboard otherwise, and says when neither works', async () => {
    const calls: string[] = [];
    const share = async (d: { url: string }): Promise<void> => { calls.push(`share ${d.url}`); };
    const write = async (t: string): Promise<void> => { calls.push(`copy ${t}`); };
    expect(await shareWalk('u', 't', { share, coarse: true, write })).toBe('shared');
    expect(await shareWalk('u', 't', { share, coarse: false, write })).toBe('copied');
    expect(await shareWalk('u', 't', { coarse: true, write })).toBe('copied');
    expect(await shareWalk('u', 't', { share: async () => { throw new Error('no'); }, coarse: true, write })).toBe('copied');
    expect(await shareWalk('u', 't', { share: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); }, coarse: true, write })).toBe('shared');
    expect(await shareWalk('u', 't', { coarse: false })).toBe('failed');
    expect(calls).toEqual(['share u', 'copy u', 'copy u', 'copy u']);
  });
});

describe('the Flats list', () => {
  const b = parseBuilding(JSON.parse(fs.readFileSync(path.join(root, 'public/buildings/sample-tower/building.json'), 'utf8')));
  it('lists the flats of every level that has flats, with type and carpet area as the building states them', () => {
    const lv = flatLevels(b);
    expect(lv.map((l) => l.level.id)).toEqual(['l2', 'l3']);
    expect(lv[0].flats.map((f) => f.title)).toEqual(['Flat 201', 'Flat 202', 'Flat 203', 'Flat 204']);
    for (const f of lv[0].flats) expect(f.detail).toMatch(/^[23] BHK · [\d,]+ sq ft$/);
  });
  it('splits a flat name into its own name and what it is', () => {
    const s = b.levels.find((l) => l.id === 'l2')!.spaces.find((x) => x.id === 'f2-201')!;
    expect(flatRow(b, s)).toEqual({ id: 'f2-201', title: 'Flat 201', detail: '2 BHK · 644 sq ft' });
  });
  it('shows the first sentence of a long line', () => {
    expect(firstSentence('Lobby, lifts and a clubhouse. The flats follow a brochure; the floor is ours.')).toBe('Lobby, lifts and a clubhouse.');
    expect(firstSentence('One line')).toBe('One line.');
  });
});

describe('one design language: the chrome is sized in tokens', () => {
  // a pixel size written raw (over 1.5 px) is a size that does not scale on a wall display; media queries and zoom-scaled panels are the exceptions
  const files = ['src/buyer/buyer.css', 'src/buyer/nav/nav.css', 'src/building/building.css', 'src/start/start.css', 'src/upload/upload.css'];
  it.each(files)('%s has no raw pixel sizes', (f) => {
    const bad: string[] = [];
    fs.readFileSync(path.join(root, f), 'utf8').split('\n').forEach((line, i) => {
      const t = line.trimStart();
      if (t.startsWith('@media') || t.startsWith('@supports') || t.startsWith('/*') || t.startsWith('*') || line.includes('url(') || line.includes('zoom:')) return;
      const code = line.split('/*')[0];
      for (const m of code.matchAll(/(?<![\w.#-])(\d+(?:\.\d+)?)px\b/g)) if (Number(m[1]) > 1.5) bad.push(`${f}:${i + 1} ${m[0]}`);
    });
    expect(bad).toEqual([]);
  });
  it('the tokens file defines the scale, the radii, the type scale, the glass and the layers', () => {
    const t = fs.readFileSync(path.join(root, 'src/brand/tokens.css'), 'utf8');
    for (const v of ['--wt-u', '--wt-sp-4', '--wt-r-panel', '--wt-r-control', '--wt-fs-md', '--wt-glass', '--wt-glass-blur', '--wt-glass-shadow', '--wt-z-sheet', '--wt-z-curtain']) expect(t).toContain(`${v}:`);
  });
});
