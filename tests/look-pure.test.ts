// C11a, SPEC 16.8 checks 1, 2, 6 and 7: floor AO, sun, buildShell with no options, quality guess. Pure, no browser.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty, truthGrid } from '../scripts/make-test-room';
import { buildShell } from '../src/engine/shell';
import { aoAt, buildAoField } from '../src/look/floor-ao';
import { FpsWatch, FrameTimer, TIERS, guessTier, lowerTier, parseTier, stepDown, tierFromQuery } from '../src/look/quality';
import { chooseBackdrop, backdropPath } from '../src/look/sky';
import { findSunOpening, kelvinToLinearRgb, sunElevationDeg, sunKelvin, sunState, sunWarmth } from '../src/look/sun';
import { parseLookFile } from '../src/look/types';

const layout = buildTruthProperty('empty').layout;

describe('floor-ao (SPEC 16.8 check 1)', () => {
  const empty = buildAoField(truthGrid('empty'));
  const furnished = buildAoField(truthGrid('furnished'));
  it('is at most 0.72 at 5 cm from a wall and at least 0.98 at 1 m', () => {
    // west wall of the bedroom is x = 0; walk along z = 2.5
    expect(aoAt(empty, 0.05, 2.5)).toBeLessThanOrEqual(0.72);
    expect(aoAt(empty, 1.0, 2.5)).toBeGreaterThanOrEqual(0.98);
    // south wall z = 5
    expect(aoAt(empty, 2.0, 4.95)).toBeLessThanOrEqual(0.72);
    expect(aoAt(empty, 2.0, 4.0)).toBeGreaterThanOrEqual(0.98);
  });
  it('is under 0.8 beside the bed footprint edge of the furnished variant', () => {
    // the bed is x 0..2, z 1.5..3.0, 55 cm high
    expect(aoAt(furnished, 2.05, 2.25)).toBeLessThan(0.8);
    expect(aoAt(furnished, 1.0, 3.05)).toBeLessThan(0.8);
    expect(aoAt(empty, 2.05, 2.25)).toBeGreaterThan(0.98); // the same spot in the empty flat
  });
  it('rises monotonically with the distance from a wall', () => {
    let prev = 0;
    for (let d = 0.03; d <= 1.2; d += 0.03) {
      const v = aoAt(empty, d, 2.5);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = v;
    }
  });
  it('a low rug does not occlude (under 20 cm)', () => {
    const g = truthGrid('empty');
    const low = { ...g, cells: Uint8Array.from(g.cells) };
    const i = Math.round((2.0 - g.originX) / g.cellM), j = Math.round((2.0 - g.originZ) / g.cellM);
    for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) low.cells[(j + dj) * g.nx + (i + di)] = 10;
    expect(aoAt(buildAoField(low), 2.0, 2.0)).toBeGreaterThan(0.98);
  });
});

describe('sun (SPEC 16.8 check 2)', () => {
  it('is 20 to 35 degrees up at 16:30', () => {
    const e = sunElevationDeg(16.5);
    expect(e).toBeGreaterThan(20);
    expect(e).toBeLessThan(35);
    expect(sunState(layout, null, 16.5).elevationDeg).toBeCloseTo(e, 9);
  });
  it('picks the sliding opening on the truth flat (it faces the balcony, the widest outdoor opening)', () => {
    const o = findSunOpening(layout)!;
    expect(o.openingId).toBe('slider');
    expect(o.out).toEqual({ x: 0, z: -1 });
  });
  it('with north unknown the light enters the bedroom through the sliding opening (dot with its inward normal > 0.7)', () => {
    for (const h of [16.5]) {
      const s = sunState(layout, null, h);
      const inward = { x: -s.opening!.out.x, z: -s.opening!.out.z };
      expect(s.lightDirXZ.x * inward.x + s.lightDirXZ.z * inward.z).toBeGreaterThan(0.7);
      expect(s.label).toBe('Light direction is illustrative.');
      expect(s.known).toBe(false);
    }
  });
  it('sweeps about 50 degrees either side of the opening normal across the day', () => {
    const angle = (h: number): number => {
      const s = sunState(layout, null, h);
      const inward = { x: -s.opening!.out.x, z: -s.opening!.out.z };
      const dot = s.lightDirXZ.x * inward.x + s.lightDirXZ.z * inward.z;
      return (Math.acos(Math.min(1, dot)) * 180) / Math.PI;
    };
    expect(angle(16.5)).toBeCloseTo(30, 0);
    expect(angle(6)).toBeLessThan(55);
    expect(angle(19)).toBeLessThan(55);
  });
  it('with northDeg set, the azimuth at 12:30 is 180 degrees (south) and the plan direction follows the north', () => {
    const s = sunState(layout, { northDeg: 0 }, 12.5);
    expect(s.bearingDeg).toBeCloseTo(180, 1);
    expect(s.label).toBe('Sun direction is approximate.');
    expect(s.toSun[0]).toBeCloseTo(0, 6);
    expect(s.toSun[2]).toBeGreaterThan(0); // plan -z is north, so south is +z
    const rot = sunState(layout, { northDeg: 90 }, 12.5); // -z points east, so south is +x
    expect(rot.bearingDeg).toBeCloseTo(180, 1);
    expect(rot.toSun[0]).toBeGreaterThan(0);
    expect(Math.abs(rot.toSun[2])).toBeLessThan(1e-6);
  });
  it('colour temperature runs 2,200 K at the ends to 5,600 K at 12:30; the colour is warm, then white', () => {
    expect(sunKelvin(6)).toBeCloseTo(2200, 6);
    expect(sunKelvin(19)).toBeCloseTo(2200, 6);
    expect(sunKelvin(12.5)).toBeCloseTo(5600, 6);
    const warm = kelvinToLinearRgb(2200), noon = kelvinToLinearRgb(5600);
    expect(warm[0]).toBe(1);
    expect(warm[2]).toBeLessThan(0.25);
    expect(noon[2]).toBeGreaterThan(0.7);
  });
});

describe('buildShell with no options (SPEC 16.8 check 6)', () => {
  const shell = buildShell(layout);
  const mat = (n: string): THREE.MeshStandardMaterial => (shell.getObjectByName(n) as THREE.Mesh).material as THREE.MeshStandardMaterial;
  it('keeps today\'s material types, colours and roughness', () => {
    expect(mat('floor:bedroom').type).toBe('MeshStandardMaterial');
    expect(mat('floor:bedroom').roughness).toBe(0.35);
    expect(mat('walls:bedroom').color.getHexString()).toBe('f2efe9');
    expect(mat('walls:bedroom').roughness).toBe(0.9);
    expect(mat('ceiling:bedroom').color.getHexString()).toBe('fafaf8');
    expect(mat('ceiling:bedroom').roughness).toBe(0.95);
    expect(mat('railings').color.getHexString()).toBe('3a3a3c');
    expect(mat('railings').roughness).toBe(0.6);
    expect(mat('frames').color.getHexString()).toBe('4a3528');
    expect(mat('frames').roughness).toBe(0.7);
    const pane = (shell.getObjectByName('panes') as THREE.Mesh).material as THREE.MeshBasicMaterial;
    expect(pane.type).toBe('MeshBasicMaterial');
    expect(pane.color.getHexString()).toBe('cfe8ff');
    expect(pane.transparent).toBe(false);
    expect(mat('walls:bedroom').userData.shared).toBeUndefined();
  });
  it('an empty options object changes nothing', () => {
    const again = buildShell(layout, {});
    expect(again.children.map((c) => c.name)).toEqual(shell.children.map((c) => c.name));
  });
});

describe('quality (SPEC 16.8 check 7)', () => {
  const dev = (renderer: string, extra: Record<string, unknown> = {}) => ({ renderer, touch: false, ...extra });
  it('weak GPU strings give low', () => {
    expect(guessTier(dev('Mali-G52', { touch: true }))).toBe('low');
    expect(guessTier(dev('ANGLE (Qualcomm, Adreno (TM) 506, OpenGL ES 3.2)', { touch: true }))).toBe('low');
    expect(guessTier(dev('Adreno (TM) 506', { touch: true }))).toBe('low');
    expect(guessTier(dev('SwiftShader'))).toBe('low');
    expect(guessTier(dev('llvmpipe (LLVM 15.0.7, 256 bits)'))).toBe('low');
    expect(guessTier(dev('PowerVR Rogue GE8320', { touch: true }))).toBe('low');
  });
  it('Apple M2 with a fine pointer gives high', () => {
    expect(guessTier(dev('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'))).toBe('high');
    expect(guessTier(dev('Apple M2'))).toBe('high');
  });
  it('a touch device is medium, 4 GB or less is low, a newer Adreno on a phone is medium', () => {
    expect(guessTier(dev('Adreno (TM) 740', { touch: true }))).toBe('medium');
    expect(guessTier(dev('Apple GPU', { touch: true }))).toBe('medium');
    expect(guessTier(dev('Apple GPU', { touch: true, deviceMemory: 4 }))).toBe('low');
    expect(guessTier(dev('NVIDIA GeForce RTX 3060', { deviceMemory: 2 }))).toBe('low');
  });
  it('?quality= forces a tier, anything else is ignored', () => {
    expect(tierFromQuery('?scene=x&quality=low')).toBe('low');
    expect(tierFromQuery('?quality=high')).toBe('high');
    expect(tierFromQuery('?quality=ultra')).toBeNull();
    expect(parseTier(null)).toBeNull();
  });
  it('the tier table matches SPEC 16.5', () => {
    expect(TIERS.low).toMatchObject({ fpsTarget: 30, pixelRatioCap: 1, shadow: 'none', environment: false, reflection: 'none', post: false });
    expect(TIERS.medium).toMatchObject({ fpsTarget: 50, pixelRatioCap: 1.5, shadow: 'static', shadowMapSize: 1024, reflection: 'cube', post: false });
    expect(TIERS.high).toMatchObject({ fpsTarget: 55, pixelRatioCap: 2, shadow: 'live', shadowMapSize: 2048, reflection: 'planar', post: true, bloom: true });
    expect(stepDown('high')).toBe('medium');
    expect(stepDown('medium')).toBe('low');
    expect(lowerTier('high', 'medium')).toBe('medium');
  });
  it('the watchdog fires once the 4 second average is under the target, and ignores long gaps', () => {
    const w = new FpsWatch(50);
    let fired = false;
    for (let i = 0; i < 200 && !fired; i++) fired = w.frame(1 / 30);
    expect(fired).toBe(true);
    const ok = new FpsWatch(50);
    let bad = false;
    for (let i = 0; i < 400; i++) bad = bad || ok.frame(1 / 60);
    expect(bad).toBe(false);
    const hidden = new FpsWatch(50);
    for (let i = 0; i < 100; i++) expect(hidden.frame(3)).toBe(false); // a backgrounded tab
    const t = new FrameTimer(40);
    let fps: number | null = null;
    for (let i = 0; i < 40; i++) fps = t.frame(1 / 20);
    expect(fps).toBeCloseTo(20, 6);
  });
});

describe('sky and look.json', () => {
  it('floor 5 and up is the city by day (dusk from 17:30), below 5 the pure sky, True colours always the sky', () => {
    expect(chooseBackdrop(null, 16.5, false)).toBe('rooftop_day');
    expect(chooseBackdrop(null, 12, false)).toBe('rooftop_day');
    expect(chooseBackdrop(null, 17.5, false)).toBe('rooftop_night');
    expect(chooseBackdrop({ floorNumber: 2 }, 12, false)).toBe('sky');
    expect(chooseBackdrop({ floorNumber: 9 }, 12, true)).toBe('sky');
    expect(chooseBackdrop({ backdrop: 'rooftop_night', floorNumber: 2 }, 11, false)).toBe('rooftop_night');
  });
  it('the window view is a jpg: 2048 wide on low and medium, 4096 on high', () => {
    expect(backdropPath('rooftop_day', 'backdrop')).toBe('hdri/view_day_bg.jpg');
    expect(backdropPath('sky', '1k')).toBe('hdri/view_sky_bg.jpg');
    expect(backdropPath('rooftop_night', '2k')).toBe('hdri/view_dusk_bg4k.jpg');
  });
  it('the sun is daylight white around midday and only gently warm at 16:30', () => {
    expect(sunWarmth(12.5)).toBeCloseTo(0, 6);
    expect(sunWarmth(16.5)).toBeGreaterThan(0.1);
    expect(sunWarmth(16.5)).toBeLessThan(0.25);
    expect(sunWarmth(19)).toBeGreaterThan(sunWarmth(16.5));
    const noon = sunState(layout, null, 12.5).colour;
    expect(noon[0]).toBeCloseTo(1, 6); expect(noon[1]).toBeCloseTo(1, 6); expect(noon[2]).toBeCloseTo(1, 6);
    const aft = sunState(layout, null, 16.5).colour;
    expect(aft[0]).toBeCloseTo(1, 6);
    expect(aft[2]).toBeGreaterThan(0.7); // a touch of warmth, nowhere near the 2,200 K orange
  });
  it('look.json is read leniently', () => {
    expect(parseLookFile(null)).toBeNull();
    expect(parseLookFile({ version: 1, floorNumber: 3.2, northDeg: -90, hour: 30, backdrop: 'nope' })).toEqual({ version: 1, floorNumber: 3, northDeg: 270, hour: 19 });
  });
});
