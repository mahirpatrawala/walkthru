// SPEC 16.18: the follow camera glides. Look smoothing at any frame rate, the first <-> third person cross-fade, the close-to-a-wall fade into the eyes,
// and the small director API (driveTo, releaseDrive, setBodyHidden, setFov) that the tour driver can use without touching camera.ts.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { truthGrid } from '../scripts/make-test-room';
import { FollowCamera } from '../src/engine/camera';

const grid = truthGrid('empty');
const NO = { dx: 0, dy: 0, zoom: 0 };
function make(): { cam: FollowCamera; camera: THREE.PerspectiveCamera } {
  const camera = new THREE.PerspectiveCamera(60, 16 / 9, 0.05, 200);
  const cam = new FollowCamera(camera, () => grid, 2.6);
  cam.setTarget({ x: 2, z: 2.5 }, 1.75);
  cam.update(1 / 60, NO);
  return { cam, camera };
}
const yawOf = (camera: THREE.PerspectiveCamera): number => { const d = camera.getWorldDirection(new THREE.Vector3()); return Math.atan2(d.x, d.z) * 180 / Math.PI; };

describe('look smoothing', () => {
  it('a yaw change is a glide, not a step, and ends in the same place at 30 and 120 fps', () => {
    const at = (fps: number): { mid: number; end: number; step: number } => {
      const { cam, camera } = make();
      cam.yawDeg = 90;
      let prev = yawOf(camera), step = 0, mid = 0;
      for (let i = 0; i < fps * 1.5; i++) {
        cam.update(1 / fps, NO);
        const y = yawOf(camera);
        step = Math.max(step, Math.abs(y - prev) * fps); // degrees a second
        prev = y;
        if (i === Math.round(fps * 0.2) - 1) mid = y;
      }
      return { mid, end: yawOf(camera), step };
    };
    const a = at(30), b = at(120);
    expect(a.end).toBeCloseTo(90, 1);
    expect(b.end).toBeCloseTo(90, 1);
    expect(Math.abs(a.mid - b.mid)).toBeLessThan(0.5); // the same place after 0.2 s at either rate
    expect(a.mid).toBeGreaterThan(10);
    expect(a.mid).toBeLessThan(80); // not there yet, not still at 0
    expect(Math.abs(a.step - b.step)).toBeLessThan(60); // the same peak turning speed
  });
  it('never overshoots', () => {
    const { cam, camera } = make();
    cam.yawDeg = 120;
    for (let i = 0; i < 180; i++) { cam.update(1 / 60, NO); expect(yawOf(camera)).toBeLessThanOrEqual(120.01); }
  });
  it('a 2 s frame counts as 0.1 s: no lurch', () => {
    const { cam, camera } = make();
    cam.yawDeg = 90;
    cam.update(2, NO);
    expect(yawOf(camera)).toBeLessThan(60);
  });
});

describe('the view cross-fade', () => {
  it('first -> third and back takes about 360 ms with no frame moving the camera by more than a few centimetres', () => {
    const { cam, camera } = make();
    cam.setView(true, { instant: true });
    cam.setEye({ x: 2.05, y: 1.62, z: 2.5 });
    for (let i = 0; i < 10; i++) cam.update(1 / 60, NO);
    const eye = camera.position.clone();
    cam.firstPerson = false;
    let prev = camera.position.clone(), worst = 0, frames = 0;
    while (cam.viewBlend > 0 && frames < 120) {
      cam.update(1 / 60, NO);
      worst = Math.max(worst, camera.position.distanceTo(prev));
      prev = camera.position.clone();
      frames++;
    }
    expect(frames).toBeGreaterThan(18); // about 0.36 s at 60 fps
    expect(frames).toBeLessThan(26);
    expect(worst).toBeLessThan(0.16);
    expect(camera.position.distanceTo(eye)).toBeGreaterThan(1.5); // it really moved out to the boom
    expect(cam.fade).toBeLessThan(0.05);
    // and in again: the body is hidden from half way
    cam.firstPerson = true;
    for (let i = 0; i < 10; i++) cam.update(1 / 60, NO);
    expect(cam.fade).toBeGreaterThan(0.2);
    expect(cam.fade).toBeLessThan(1);
    for (let i = 0; i < 60; i++) cam.update(1 / 60, NO);
    expect(cam.fade).toBe(1);
  });
  it('the field of view and the near plane cross-fade with it, and a resize in the middle asks the camera, not a constant', () => {
    const { cam, camera } = make();
    expect(camera.fov).toBe(60);
    const fovFor = camera.userData.fovFor as (aspect: number) => number;
    expect(fovFor(16 / 9)).toBe(60);
    cam.setView(true, { instant: true });
    cam.update(1 / 60, NO);
    expect(camera.fov).toBeCloseTo(72, 6);
    expect(camera.near).toBeCloseTo(0.03, 6);
    expect(fovFor(0.5)).toBe(80);
  });
});

describe('close to a wall (third person glides to the eyes)', () => {
  it('the fade rises as the boom shortens, continuously, and the body is hidden past 0.55', () => {
    const { cam } = make();
    cam.yawDeg = 270;
    cam.pitchDeg = 5;
    let prev = 0, worst = 0;
    for (let i = 0; i < 180; i++) {
      cam.setTarget({ x: Math.min(3.8, 1.4 + i * 0.03), z: 2.5 }, 1.75);
      cam.update(1 / 60, NO);
      worst = Math.max(worst, Math.abs(cam.fade - prev));
      prev = cam.fade;
    }
    expect(cam.fade).toBeGreaterThan(0.9);
    expect(worst).toBeLessThan(0.1); // a ramp, never a step
  });
});

describe('the director API', () => {
  it('driveTo eases the camera to a pose with no overshoot, holds it, and releaseDrive gives it back', () => {
    const { cam, camera } = make();
    const free = camera.position.clone();
    cam.driveTo({ x: 1, y: 1.6, z: 1 }, { x: 3, y: 1.2, z: 1 }, 0.4);
    expect(cam.driven).toBe(true);
    let prev = camera.position.distanceTo(new THREE.Vector3(1, 1.6, 1));
    for (let i = 0; i < 180; i++) {
      cam.update(1 / 60, NO);
      const d = camera.position.distanceTo(new THREE.Vector3(1, 1.6, 1));
      expect(d).toBeLessThanOrEqual(prev + 0.02);
      prev = d;
    }
    expect(prev).toBeLessThan(0.05);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    expect(dir.x).toBeGreaterThan(0.95);
    // the walker moving or the look drag changes nothing while it is held
    cam.setTarget({ x: 3, z: 3 }, 1.75);
    cam.update(1 / 60, { dx: 100, dy: 0, zoom: 0 });
    expect(camera.position.distanceTo(new THREE.Vector3(1, 1.6, 1))).toBeLessThan(0.06);
    cam.releaseDrive(0.4);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, NO);
    expect(cam.driven).toBe(false);
    expect(camera.position.distanceTo(free)).toBeGreaterThan(0.3); // it is back to following the walker (who moved), not stuck at the driven pose
  });
  it('taking over does not cut: the first frame of a drive is still where the camera was', () => {
    const { cam, camera } = make();
    const before = camera.position.clone();
    cam.driveTo({ x: 0, y: 3, z: 0 }, { x: 4, y: 1, z: 4 }, 0.5);
    cam.update(1 / 60, NO);
    expect(camera.position.distanceTo(before)).toBeLessThan(0.1);
  });
  it('setBodyHidden overrides the fade, null gives it back', () => {
    const { cam } = make();
    expect(cam.fade).toBe(0);
    cam.setBodyHidden(true);
    expect(cam.fade).toBe(1);
    cam.setBodyHidden(false);
    expect(cam.fade).toBe(0);
    cam.setBodyHidden(null);
    expect(cam.fade).toBe(0);
  });
  it('setFov eases to a field of view and back, without a step', () => {
    const { cam, camera } = make();
    cam.setFov(90, 0.3);
    let prev = camera.fov, worst = 0;
    for (let i = 0; i < 120; i++) { cam.update(1 / 60, NO); worst = Math.max(worst, Math.abs(camera.fov - prev)); prev = camera.fov; }
    expect(camera.fov).toBeCloseTo(90, 1);
    expect(worst).toBeLessThan(3);
    cam.setFov(null, 0.3);
    for (let i = 0; i < 240; i++) cam.update(1 / 60, NO);
    expect(camera.fov).toBeCloseTo(60, 2);
  });
});

describe('the eye in first person', () => {
  it('holds its height steady against a head bob of a centimetre, and lets a sit through quickly', () => {
    const { cam, camera } = make();
    cam.setView(true, { instant: true });
    cam.setEye({ x: 2, y: 1.6, z: 2.5 });
    for (let i = 0; i < 30; i++) cam.update(1 / 60, NO);
    let lo = 9, hi = -9;
    for (let i = 0; i < 120; i++) { cam.setEye({ x: 2, y: 1.6 + 0.012 * Math.sin(i * 0.5), z: 2.5 }); cam.update(1 / 60, NO); lo = Math.min(lo, camera.position.y); hi = Math.max(hi, camera.position.y); }
    expect(hi - lo).toBeLessThan(0.012); // less than half of the bob's own 24 mm
    cam.setEye({ x: 2, y: 0.9, z: 2.5 });
    for (let i = 0; i < 40; i++) cam.update(1 / 60, NO);
    expect(camera.position.y).toBeLessThan(1.0); // sitting down is not slowed by the filter
  });
});
