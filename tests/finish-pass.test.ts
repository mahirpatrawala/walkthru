// SPEC 16.26 "Finish pass": the pure parts. The fixture glow by day, the tier tone curve, the baked lamp share, the cool-cast fix of the day presets.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_PRESET, PRESET_HOURS, TRUE_GRADE, gradeAt, glowLevel, interiorLevel, hexToLinear } from '../src/look/grade';
import { DAY_LAMP_SHARE, componentWeights, lampLevel } from '../src/look/baked/weights';
import { TIER_CONTRAST, TIER_PIVOT, installTierToneMap } from '../src/look/tonemap';
import { createKitMaterials, DOWNLIGHT_LIT } from '../src/look/kit/materials';
import { skyPixels } from '../src/look/sky';

describe('fixtures that are only ever seen glow by day', () => {
  it('a recessed lamp and a cove LED keep a part of their glow in the day presets, a tube and a fan do not', () => {
    for (const p of ['morning', 'afternoon'] as const) {
      const g = gradeAt(PRESET_HOURS[p]);
      expect(interiorLevel('lamp', g)).toBe(0); // the real lights are still off
      expect(glowLevel('lamp', g)).toBeGreaterThan(0.4);
      expect(glowLevel('lamp', g)).toBeLessThan(0.75);
      expect(glowLevel('cove', g)).toBe(glowLevel('lamp', g));
      expect(glowLevel('tube', g)).toBe(0);
      expect(glowLevel('fan', g)).toBe(0);
    }
  });
  it('the glow rises through the evening to full at night and is never lower than the lights', () => {
    let last = 0;
    for (const h of [8.5, 15, 17.8, 19.1, 20.5]) {
      const g = gradeAt(h);
      expect(glowLevel('lamp', g)).toBeGreaterThanOrEqual(Math.max(interiorLevel('lamp', g), last - 1e-9));
      last = glowLevel('lamp', g);
    }
    expect(last).toBe(1);
  });
  it('True colours has no glow at all', () => {
    expect(glowLevel('lamp', TRUE_GRADE)).toBe(0);
    expect(glowLevel('cove', TRUE_GRADE)).toBe(0);
  });
  it('the downlight glass starts at its FULL-ON value (the look scales it; a material that starts at 0 can never glow)', () => {
    const m = createKitMaterials({ wallColor: '#ffffff', ceilingColor: '#ffffff', floorColor: '#cccccc', railingColor: '#888888', frameColor: '#ffffff' } as never);
    expect(m.downlight.emissiveIntensity).toBe(DOWNLIGHT_LIT);
    m.setLevel('cove', 0.5);
    expect(m.lens.cove.emissiveIntensity).toBeGreaterThan(0.2);
    expect(m.lens.cove.emissiveIntensity).toBeLessThan(2);
    m.setLit('cove', true);
    expect(m.isLit('cove')).toBe(true);
    m.setLit('cove', false);
    expect(m.lens.cove.emissiveIntensity).toBeCloseTo(0.2, 6);
    m.dispose();
  });
  it('the baked lamps component carries a small share by day and the whole of it with the lights', () => {
    expect(lampLevel({ tube: 0, glow: 0.6 })).toBeCloseTo(0.6 * DAY_LAMP_SHARE, 9);
    expect(lampLevel({ tube: 1, glow: 1 })).toBe(1);
    expect(lampLevel({ tube: 0 })).toBe(0);
    const g = gradeAt(PRESET_HOURS.afternoon);
    const w = componentWeights({ grade: g, skyScale: 1, sunScale: 1, sunHours: [null, 15, null], skyBoost: 1 });
    expect(w.lamps[0]).toBeGreaterThan(0);
    expect(w.lamps[0]).toBeLessThan(0.2);
    expect(w.cove[0]).toBe(0);
  });
});

describe('the tier tone curve', () => {
  it('installs once into three\'s custom tone mapping hook, ACES then a contrast about the mean of a lit interior', () => {
    expect(installTierToneMap()).toBe(true);
    expect(installTierToneMap()).toBe(true);
    const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
    expect(chunk).toContain('CustomToneMapping( vec3 color ) {\n\tcolor = ACESFilmicToneMapping( color );');
    expect(chunk).toContain('exp( -( l1 - 0.420 ) * 1.200 /'); // the highlight shoulder: no clipping of a bright wall or a sunlit floor
    expect(chunk).toContain(`pow( l1 / ${TIER_PIVOT.toFixed(3)}, ${TIER_CONTRAST.toFixed(3)} )`); // the toe: a dark surface is deepened, never crushed to black
    expect(chunk).not.toContain('{ return color; }');
  });
});

describe('the day presets read warm and clean, not grey-green', () => {
  it('white balance and sky half pull no more green than red or blue lets through', () => {
    for (const p of ['morning', 'afternoon'] as const) {
      const g = gradeAt(PRESET_HOURS[p]);
      // linear green against the mean of red and blue: a warm white sits at or under 1.0, a green-grey one above it
      const wb = g.post.whiteBalance, sky = g.hemiSky;
      expect(wb[1] / ((wb[0] + wb[2]) / 2)).toBeLessThanOrEqual(1.0);
      expect(sky[1] / ((sky[0] + sky[2]) / 2)).toBeLessThanOrEqual(1.0);
      // still warm: red at least blue
      expect(wb[0]).toBeGreaterThanOrEqual(wb[2]);
    }
  });
  it('the contrast of the day presets is real (the pull-apart of the mid-tones that gives clean whites and dark corners)', () => {
    expect(gradeAt(PRESET_HOURS[DEFAULT_PRESET]).post.contrast).toBeGreaterThanOrEqual(1.3);
    expect(gradeAt(PRESET_HOURS.afternoon).exposure).toBeLessThan(1.45);
  });
  it('the window sky is blue towards the horizon by day, not white haze, and stays under 1.0', () => {
    const g = gradeAt(PRESET_HOURS.afternoon).sky;
    const px = skyPixels(g, 40, 64, 32);
    const at = (el: number): number[] => { const j = Math.min(31, Math.floor(((el + Math.PI / 2) / Math.PI) * 32)); const o = (j * 64 + 40) * 4; return [px[o], px[o + 1], px[o + 2]]; };
    const low = at(0.2); // about 11 degrees up: where a window looks
    expect(low[2]).toBeGreaterThan(low[0] + 0.05); // blue, not neutral
    for (const v of low) expect(v).toBeLessThanOrEqual(1);
    void hexToLinear;
  });
});
