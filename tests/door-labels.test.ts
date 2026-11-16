import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { doorLabels, doorLabelWidthM, mountDoorLabels } from '../src/buyer/door-labels';
import { resolveDoors } from '../src/core/doors';
import * as THREE from 'three';
import type { PropertyFile } from '../src/types';

const load = (id: string): PropertyFile => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'scenes', id, 'property.json'), 'utf8'));

describe('door labels', () => {
  const flat = load('test-tower-flat-3bhk-a');
  const labels = doorLabels(flat.layout, 'home');
  const doors = resolveDoors(flat.layout);
  const name = (id: string | null) => flat.layout.rooms.find((r) => r.id === id)?.label;

  it('every door between two rooms is named on both sides, each side naming the room beyond', () => {
    for (const d of doors) {
      const other = d.rooms[0] === d.roomId ? d.rooms[1] : d.rooms[0];
      const mine = labels.filter((l) => l.doorId === d.id);
      if (other === null) { expect(mine).toEqual([{ doorId: d.id, side: 1, text: 'Exit' }]); continue; }
      expect(mine.find((l) => l.side === 1)?.text).toBe(name(other));
      expect(mine.find((l) => l.side === -1)?.text).toBe(name(d.roomId));
    }
    expect(labels.length).toBeGreaterThan(10);
  });
  it('a shared space leaves its outside doors to the building signboards', () => {
    const gym = load('test-tower-club-gym');
    expect(doorLabels(gym.layout, 'gym').some((l) => l.text === 'Exit')).toBe(false);
  });
  it('boards sit above the head, on the wall face of their side, and are freed', () => {
    const scene = new THREE.Scene();
    const h = mountDoorLabels(scene, flat.layout, 'home');
    expect(h.count).toBe(labels.length);
    const g = scene.getObjectByName('door-labels')!;
    for (const m of g.children) {
      const [, id, side] = m.name.split(':');
      const d = doors.find((x) => x.id === id)!;
      expect(m.position.y).toBeGreaterThan(d.headM);
      const u = (d.u0 + d.u1) / 2;
      const along = (m.position.x - (d.edgeA.x + d.dir.x * u)) * d.out.x + (m.position.z - (d.edgeA.z + d.dir.z * u)) * d.out.z;
      expect(along).toBeCloseTo(Number(side) === 1 ? -0.006 : d.depth + 0.006, 3);
    }
    h.dispose();
    expect(scene.getObjectByName('door-labels')).toBeUndefined();
  });
  it('width follows the words within limits', () => {
    expect(doorLabelWidthM('Exit')).toBe(0.34);
    expect(doorLabelWidthM('Master bedroom')).toBeCloseTo(0.84);
    expect(doorLabelWidthM('x'.repeat(60))).toBe(1.3);
  });
});
