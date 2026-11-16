// How the look and the camera treat an open-air space (SPEC 19.1): the exposure and the shade fill, the lamps, the interior lights that are not
// invented, and a camera boom that stops at the edge of the space instead of passing into nothing.
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { boomDistance } from '../src/core/grid-query';
import { createGrid } from '../src/core/grid-codec';
import { InteriorLights } from '../src/look/interior';
import { TIERS } from '../src/look/quality';
import { gradeAt } from '../src/look/grade';
import { outdoorExposure, outdoorHemiBoost, outdoorSunScale } from '../src/outdoor/exposure';
import { GRID_FREE, GRID_VOID } from '../src/types';
import type { Layout } from '../src/types';

describe('outdoor exposure and light', () => {
  it('full sun is held down by 30 %, dusk and night are not touched', () => {
    expect(outdoorExposure(gradeAt(15))).toBeLessThan(0.78);
    expect(outdoorExposure(gradeAt(15))).toBeGreaterThan(0.68);
    expect(outdoorExposure(gradeAt(20.5))).toBe(1);
    expect(outdoorExposure(gradeAt(8.5))).toBeGreaterThan(outdoorExposure(gradeAt(15)) - 0.05);
  });
  it('the sky fills the shade by day and the moon is lifted at night: a shadow outdoors is never black', () => {
    expect(outdoorHemiBoost(gradeAt(15))).toBeGreaterThanOrEqual(1.3);
    expect(outdoorHemiBoost(gradeAt(19.1))).toBeGreaterThan(outdoorHemiBoost(gradeAt(15)));
    expect(outdoorHemiBoost(gradeAt(20.5))).toBe(2.2);
  });
  it('the low tier, which has no sun shadow, still gets a sun outdoors (0.1 indoors)', () => {
    expect(TIERS.low.sunScale).toBeLessThan(0.2);
    expect(outdoorSunScale(TIERS.low.sunScale)).toBeGreaterThanOrEqual(0.8);
    expect(outdoorSunScale(TIERS.medium.sunScale)).toBe(1);
  });
});

describe('interior lights outdoors', () => {
  const layout = { wallHeightM: 3, rooms: [{ id: 'r', roomType: 'other', label: 'r', polygon: [{ x: 0, z: 0 }, { x: 4, z: 0 }, { x: 4, z: 4 }, { x: 0, z: 4 }], edges: ['wall', 'wall', 'wall', 'wall'] }], openings: [] } as unknown as Layout;
  it('a room gets one virtual ceiling light when nothing is tagged; an open-air space gets none', () => {
    const indoor = new InteriorLights(new THREE.Scene(), layout);
    expect(indoor.count()).toEqual({ fixtures: 0, virtual: 1 });
    const out = new InteriorLights(new THREE.Scene(), layout);
    out.setOutdoor(true);
    expect(out.count()).toEqual({ fixtures: 0, virtual: 0 });
  });
  it('a tagged lamp is a fixture outdoors too', () => {
    const scene = new THREE.Scene();
    const out = new InteriorLights(scene, layout);
    out.setOutdoor(true);
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), new THREE.MeshStandardMaterial({ emissive: '#fff', emissiveIntensity: 1 }));
    lamp.position.set(2, 3, 2);
    scene.add(lamp);
    out.setRoots([scene]);
    out.register(lamp, 'lamp');
    expect(out.count().fixtures).toBe(1);
  });
});

describe('the open-air camera boom', () => {
  it('stops where the space ends (void) when asked, and passes through void indoors as it always did', () => {
    const g = createGrid(0, 0, 100, 100, GRID_VOID);
    for (let j = 20; j < 100; j++) for (let i = 20; i < 100; i++) g.cells[j * 100 + i] = GRID_FREE; // the space starts at 1 m
    const pivot = { x: 3, y: 1.5, z: 3 };
    const dir = { x: -1, y: 0, z: 0 }; // back out of the space
    const inRoom = boomDistance(g, pivot, dir, 6, 3, false, true);
    expect(inRoom).toBeGreaterThan(1.5); expect(inRoom).toBeLessThan(2.1);
    expect(boomDistance(g, pivot, dir, 6, 3, false, false)).toBe(6);
  });
});
