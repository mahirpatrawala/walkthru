// C11a, SPEC 16.8 checks 1, 2, 6 and 7: floor AO, sun, buildShell with no options, quality guess. Pure, no browser.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty, truthGrid } from '../scripts/make-test-room';
import { buildShell } from '../src/engine/shell';
import { aoAt, buildAoField } from '../src/look/floor-ao';
import { FpsWatch, FrameTimer, TIERS, guessTier, lowerTier, parseTier, stepDown, tierFromQuery, toneMapperFromQuery } from '../src/look/quality';
import { DEFAULT_PRESET, LOOK_PRESETS, PRESET_HOURS, SUN_SET_HOUR, TRUE_GRADE, gradeAt, presetOfHour } from '../src/look/grade';
import { InteriorLights } from '../src/look/interior';
import { chooseBackdrop, backdropPath, skyPixels } from '../src/look/sky';
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
      expect(s.label).toBe('Sun direction assumed: the drawing has no north arrow.');
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
  it('the window shows the plain graded sky (no invented city) unless the broker names a backdrop', () => {
    expect(chooseBackdrop(null, 16.5, false)).toBeNull();
    expect(chooseBackdrop({}, 12, false)).toBeNull();
    expect(chooseBackdrop({ backdrop: 'rooftop_night' }, 11, true)).toBeNull(); // True colours always the plain sky
    expect(chooseBackdrop({ backdrop: 'rooftop_night' }, 11, false)).toBe('rooftop_night');
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
    expect(parseLookFile({ version: 1, floorNumber: 3.2, northDeg: -90, hour: 30, backdrop: 'nope' })).toEqual({ version: 1, floorNumber: 3, northDeg: 270, hour: 21 });
  });
});

describe('grade and presets (look-light)', () => {
  it('the four presets are four hours of one slider; Afternoon is the default', () => {
    expect(DEFAULT_PRESET).toBe('afternoon');
    for (const p of LOOK_PRESETS) expect(presetOfHour(PRESET_HOURS[p])).toBe(p);
    expect(presetOfHour(12)).toBeNull();
    expect(PRESET_HOURS.morning).toBeLessThan(PRESET_HOURS.afternoon);
    expect(PRESET_HOURS.evening).toBeLessThan(SUN_SET_HOUR);
    expect(PRESET_HOURS.night).toBeGreaterThan(SUN_SET_HOUR);
  });
  it('evening is warmer than afternoon, lower sun, lights partly on; night has no sun and the lights fully on', () => {
    const aft = gradeAt(PRESET_HOURS.afternoon), eve = gradeAt(PRESET_HOURS.evening), nig = gradeAt(PRESET_HOURS.night);
    expect(eve.sunColour[2] / eve.sunColour[0]).toBeLessThan(aft.sunColour[2] / aft.sunColour[0]);
    expect(sunElevationDeg(PRESET_HOURS.evening)).toBeLessThan(sunElevationDeg(PRESET_HOURS.afternoon));
    expect(aft.interior.tube).toBe(0);
    expect(eve.interior.cove).toBeGreaterThan(0.3);
    expect(eve.interior.cove).toBeLessThan(1);
    expect(nig.night).toBe(true);
    expect(nig.sunIntensity).toBe(0);
    expect(nig.interior).toEqual({ tube: 1, cove: 1 });
    expect(aft.night).toBe(false);
  });
  it('the blend is continuous: a small step in the hour is a small step in every number', () => {
    for (let h = 6; h < 20.9; h += 0.1) {
      const a = gradeAt(h), b = gradeAt(h + 0.1);
      expect(Math.abs(a.exposure - b.exposure)).toBeLessThan(0.05);
      expect(Math.abs(a.sunIntensity - b.sunIntensity)).toBeLessThan(0.75);
      expect(Math.abs(a.interior.tube - b.interior.tube)).toBeLessThan(0.2);
    }
  });
  it('the window sky never goes past 1.0 before exposure, so a window does not blow out', () => {
    for (const h of [6, 8.5, 12, 15, 17.8, 19.1, 20.5]) {
      const g = gradeAt(h);
      for (const k of ['zenith', 'mid', 'horizon', 'ground'] as const) for (const v of g.sky[k]) expect(v).toBeLessThanOrEqual(1);
    }
  });
  it('the sky pixels are a plain gradient: brighter near the horizon than overhead by day, a glow towards the sun, no hard horizon', () => {
    const g = gradeAt(PRESET_HOURS.afternoon).sky;
    const w = 64, h = 32;
    const px = skyPixels(g, 40, w, h);
    const at = (az: number, el: number): number[] => {
      const i = Math.min(w - 1, Math.floor((az / (2 * Math.PI) + 0.5) * w)), j = Math.min(h - 1, Math.floor(((el + Math.PI / 2) / Math.PI) * h));
      const o = (j * w + i) * 4; return [px[o], px[o + 1], px[o + 2]];
    };
    const lum = (c: number[]): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    expect(lum(at(Math.PI, 0.05))).toBeGreaterThan(lum(at(Math.PI, 1.4)));
    expect(lum(at(0, 0.7))).toBeGreaterThan(lum(at(Math.PI, 0.7)));
    // neighbouring rows across the horizon differ by little (a soft haze, not a line)
    for (let j = 0; j + 1 < h; j++) {
      const a = (j * w + 3) * 4, b = ((j + 1) * w + 3) * 4;
      expect(Math.abs(px[a + 1] - px[b + 1])).toBeLessThan(0.2);
    }
  });
  it('True colours is neutral: white light, no sun, nothing graded, no lights', () => {
    expect(TRUE_GRADE.exposure).toBe(1);
    expect(TRUE_GRADE.sunIntensity).toBe(0);
    expect(TRUE_GRADE.post.saturation).toBe(1);
    expect(TRUE_GRADE.interior).toEqual({ tube: 0, cove: 0 });
  });
  it('look.json can carry a preset', () => {
    expect(parseLookFile({ version: 1, preset: 'evening' })?.preset).toBe('evening');
    expect(parseLookFile({ version: 1, preset: 'dusk' })?.preset).toBeUndefined();
    expect(parseLookFile({ version: 1, hour: 20.5 })?.hour).toBe(20.5);
    expect(parseLookFile({ version: 1, hour: 30 })?.hour).toBe(21);
  });
  it('the tone mapper is ACES unless ?tonemap= says otherwise', () => {
    expect(toneMapperFromQuery('')).toBe('aces');
    expect(toneMapperFromQuery('?tonemap=agx')).toBe('agx');
    expect(toneMapperFromQuery('?tonemap=nope')).toBe('aces');
  });
});

describe('interior lights (look-light)', () => {
  const fixtureLayout = layout;
  const mk = (): { scene: THREE.Scene; il: InteriorLights } => { const scene = new THREE.Scene(); return { scene, il: new InteriorLights(scene, fixtureLayout) }; };
  it('with no fixtures every room gets one virtual ceiling light, so the evening still lights the rooms', () => {
    const { il } = mk();
    il.setRoots([]);
    const c = il.count();
    expect(c.fixtures).toBe(0);
    expect(c.virtual).toBeGreaterThan(0);
  });
  it('a fixture tagged with userData.walkthruLight is driven by the time of day: emissive mesh, real light, nested children', () => {
    const { scene, il } = mk();
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1, 0.05, 0.1), new THREE.MeshStandardMaterial({ emissive: '#ffffff', emissiveIntensity: 3 }));
    tube.userData.walkthruLight = 'tube';
    tube.position.set(2, 2.3, 2);
    const cove = new THREE.Group();
    cove.userData.walkthruLight = 'cove';
    const strip = new THREE.Mesh(new THREE.BoxGeometry(2, 0.02, 0.05), new THREE.MeshStandardMaterial({ emissive: '#ffb066', emissiveIntensity: 2 }));
    cove.add(strip);
    const lamp = new THREE.PointLight('#ffffff', 5);
    lamp.userData.walkthruLight = 'lamp';
    const root = new THREE.Group();
    root.add(tube, cove, lamp);
    scene.add(root);
    il.setRoots([root]);
    il.setGrade(gradeAt(PRESET_HOURS.afternoon));
    il.scan(true);
    expect((tube.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect((strip.material as THREE.MeshStandardMaterial).emissiveIntensity).toBe(0);
    expect(lamp.visible).toBe(false);
    il.setGrade(gradeAt(PRESET_HOURS.night));
    expect((tube.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(3, 6);
    expect((strip.material as THREE.MeshStandardMaterial).emissiveIntensity).toBeCloseTo(2, 6);
    expect(lamp.intensity).toBeCloseTo(5, 6);
    expect(il.count().fixtures).toBe(2); // the tube and the cove group; the PointLight is driven directly and is not pooled
    il.setGrade(gradeAt(PRESET_HOURS.evening));
    const e = (tube.material as THREE.MeshStandardMaterial).emissiveIntensity;
    expect(e).toBeGreaterThan(0);
    expect(e).toBeLessThan(3);
  });
  it('Look.registerInteriorLight-style registration tags the object and finds it', () => {
    const { il } = mk();
    const o = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ emissive: '#fff', emissiveIntensity: 1 }));
    il.register(o, 'tube');
    expect(o.userData.walkthruLight).toBe('tube');
    expect(il.count().fixtures).toBe(1);
  });
  it('the pool moves its few lights to the fixtures nearest the walker, and is empty by day', () => {
    const { scene, il } = mk();
    const fx: THREE.Object3D[] = [];
    for (const [x, z] of [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5]] as Array<[number, number]>) {
      const o = new THREE.Object3D(); o.position.set(x, 2.3, z); o.userData.walkthruLight = 'tube'; scene.add(o); fx.push(o);
    }
    il.setRoots([scene]);
    il.setPoolSize(2);
    il.setGrade(gradeAt(PRESET_HOURS.afternoon));
    for (let i = 0; i < 20; i++) il.update(0.1, { x: 1, z: 1 });
    const pool = scene.children.filter((c) => c.name === 'interior-pool') as THREE.PointLight[];
    expect(pool).toHaveLength(2);
    expect(pool.every((p) => p.intensity === 0 && !p.visible)).toBe(true);
    il.setGrade(gradeAt(PRESET_HOURS.night));
    for (let i = 0; i < 20; i++) il.update(0.1, { x: 1, z: 1 });
    expect(pool.every((p) => p.visible && p.intensity > 0)).toBe(true);
    const xs = pool.map((p) => p.position.x).sort();
    expect(xs[0]).toBe(1);
    expect(xs[1]).toBe(2);
    il.setPoolSize(0);
    expect(scene.children.filter((c) => c.name === 'interior-pool')).toHaveLength(0);
  });
});
