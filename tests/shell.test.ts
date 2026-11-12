import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { buildShell, disposeShell, shellStats } from '../src/engine/shell';

const layout = buildTruthProperty('empty').layout;
const shell = buildShell(layout);
const names = shell.children.map((c) => c.name);

describe('buildShell under Node (no canvas)', () => {
  it('floor areas are 20, 4.5, 4.8 within 0.5%', () => {
    const s = shellStats(shell);
    expect(Math.abs(s.floorAreaM2.bedroom - 20) / 20).toBeLessThan(0.005);
    expect(Math.abs(s.floorAreaM2.balcony - 4.5) / 4.5).toBeLessThan(0.005);
    expect(Math.abs(s.floorAreaM2.passage - 4.8) / 4.8).toBeLessThan(0.005);
    expect(s.wallFaceAreaM2).toBeGreaterThan(30);
  });
  it('ceilings for bedroom and passage, none for the balcony', () => {
    expect(names).toContain('ceiling:bedroom');
    expect(names).toContain('ceiling:passage');
    expect(names).not.toContain('ceiling:balcony');
  });
  it('bounding box spans y 0 to 2.6', () => {
    const b = new THREE.Box3().setFromObject(shell);
    expect(b.min.y).toBeCloseTo(0, 9);
    expect(b.max.y).toBeCloseTo(2.6, 5);
  });
  it('one frames child for 2 doors (3 boxes of 36 vertices each), one panes child', () => {
    expect(names.filter((n) => n === 'frames').length).toBe(1);
    expect(names.filter((n) => n === 'panes').length).toBe(1);
    const frames = shell.getObjectByName('frames') as THREE.Mesh;
    expect(frames.geometry.getAttribute('position').count).toBe(2 * 3 * 36);
    const panes = shell.getObjectByName('panes') as THREE.Mesh;
    expect(panes.geometry.getAttribute('position').count).toBe(6);
    expect((panes.material as THREE.MeshBasicMaterial).color.getHexString()).toBe('cfe8ff');
  });
  it('walls per room, railings, thresholds, roomId tags, winding agrees with normals', () => {
    for (const n of ['floor:bedroom', 'walls:bedroom', 'walls:passage', 'walls:balcony', 'railings']) expect(names).toContain(n);
    expect(names.filter((n) => n.startsWith('threshold:')).length).toBe(3); // door-bed, slider, door-main
    expect((shell.getObjectByName('walls:bedroom') as THREE.Mesh).userData.roomId).toBe('bedroom');
    for (const [name, sign] of [['floor:bedroom', 1], ['ceiling:bedroom', -1]] as const) {
      const g = (shell.getObjectByName(name) as THREE.Mesh).geometry;
      const p = g.getAttribute('position');
      const a = new THREE.Vector3().fromBufferAttribute(p, 0);
      const b = new THREE.Vector3().fromBufferAttribute(p, 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, 2);
      expect(Math.sign(b.sub(a).cross(c.sub(a)).y)).toBe(sign);
      expect(g.getAttribute('normal').getY(0)).toBe(sign);
    }
  });
  it('every wall triangle winds outward (geometric normal matches the stored normal)', () => {
    const g = (shell.getObjectByName('walls:bedroom') as THREE.Mesh).geometry;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i += 3) {
      const a = new THREE.Vector3().fromBufferAttribute(p, i);
      const b = new THREE.Vector3().fromBufferAttribute(p, i + 1);
      const c = new THREE.Vector3().fromBufferAttribute(p, i + 2);
      const geo = b.sub(a).cross(c.sub(a)).normalize();
      expect(geo.dot(new THREE.Vector3().fromBufferAttribute(n, i))).toBeGreaterThan(0.99);
    }
  });
  it('floor uvs are world metres over the 0.6 m tile', () => {
    const g = (shell.getObjectByName('floor:bedroom') as THREE.Mesh).geometry;
    const p = g.getAttribute('position');
    const uv = g.getAttribute('uv');
    for (let i = 0; i < p.count; i++) {
      expect(uv.getX(i)).toBeCloseTo(p.getX(i) / 0.6, 5);
      expect(uv.getY(i)).toBeCloseTo(p.getZ(i) / 0.6, 5);
    }
  });
  it('room colour overrides and plain floors', () => {
    const l = JSON.parse(JSON.stringify(layout));
    l.rooms[0].wallColor = '#ff0000';
    l.rooms[1].floorColor = '#00ff00';
    l.finishes.tile = null;
    const s = buildShell(l);
    expect(((s.getObjectByName('walls:bedroom') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
    expect(((s.getObjectByName('floor:balcony') as THREE.Mesh).material as THREE.MeshStandardMaterial).color.getHexString()).toBe('00ff00');
    const g = (s.getObjectByName('floor:bedroom') as THREE.Mesh).geometry;
    expect(g.getAttribute('uv').getX(1)).toBeCloseTo(g.getAttribute('position').getX(1), 5);
    disposeShell(s);
  });
  it('disposeShell frees geometries', () => {
    const s = buildShell(layout);
    let disposed = 0;
    s.traverse((o) => (o as THREE.Mesh).geometry?.addEventListener('dispose', () => disposed++));
    disposeShell(s);
    expect(disposed).toBeGreaterThan(8);
  });
});
