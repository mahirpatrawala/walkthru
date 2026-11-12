// SPEC 16.6.6 check 6 and the retargeting fixture (check 5).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_PERSON, PERSON_KEY, loadPerson, normalisePerson, savePerson } from '../src/buyer/person-store';
import { HEIGHT_KEY } from '../src/buyer/store';
import { buildNameMap, retargetClips, ueNameFor } from '../src/look/retarget';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('person state (check 6)', () => {
  it('defaults to male, tone 2, 175', () => {
    expect(loadPerson(mem())).toEqual({ body: 'male', tone: 2, heightCm: 175 });
    expect(DEFAULT_PERSON).toEqual({ body: 'male', tone: 2, heightCm: 175 });
  });
  it('migrates the old height key once', () => {
    const s = mem({ [HEIGHT_KEY]: '190' });
    expect(loadPerson(s)).toEqual({ body: 'male', tone: 2, heightCm: 190 });
    savePerson(s, { body: 'female', tone: 4, heightCm: 160 });
    expect(loadPerson(s)).toEqual({ body: 'female', tone: 4, heightCm: 160 }); // the person key wins afterwards
  });
  it('clamps out-of-range values', () => {
    expect(normalisePerson({ body: 'female', tone: 9, heightCm: 300 })).toEqual({ body: 'female', tone: 4, heightCm: 200 });
    expect(normalisePerson({ body: 'x', tone: -3, heightCm: 100 })).toEqual({ body: 'male', tone: 0, heightCm: 140 });
    expect(loadPerson(mem({ [PERSON_KEY]: 'not json' }))).toEqual(DEFAULT_PERSON);
    expect(loadPerson(mem({ [HEIGHT_KEY]: '500' }))).toEqual(DEFAULT_PERSON);
  });
});

describe('retargetClips on the starter man skeleton (check 5)', () => {
  const bones = JSON.parse(fs.readFileSync(path.resolve(import.meta.dirname, 'fixtures/starter-man-bones.json'), 'utf8')) as { name: string; parent: string | null }[];
  const names = bones.map((b) => b.name);
  const defBones = ['DEF-hips', 'DEF-spine.001', 'DEF-spine.002', 'DEF-spine.003', 'DEF-neck', 'DEF-head', 'DEF-shoulder.L', 'DEF-upper_arm.L', 'DEF-forearm.L', 'DEF-hand.L',
    'DEF-thigh.L', 'DEF-shin.L', 'DEF-foot.L', 'DEF-toe.L', 'DEF-f_index.01.L', 'DEF-thumb.01.L', 'DEF-shoulder.R', 'DEF-thigh.R', 'DEF-toe.R', 'DEF-f_pinky.03.R'];
  const clip = (name: string) => {
    const tracks: THREE.KeyframeTrack[] = [new THREE.VectorKeyframeTrack('DEF-hips.position', [0, 1], [0, 0.917, 0, 0, 0.9, 0.1])];
    for (const b of defBones.slice(1)) tracks.push(new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, [0, 1], [0, 0, 0, 1, 0, 0.1, 0, 0.995]));
    return new THREE.AnimationClip(name, 1, tracks);
  };
  const clips = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sitting_Enter', 'Sitting_Idle_Loop', 'Sitting_Exit'].map(clip);
  it('keeps every mapped track, scales the hips by 0.983 / 0.917, targets only existing bones', () => {
    const map = buildNameMap(defBones, names);
    expect(map.size).toBe(defBones.length);
    const hipsScale = 0.9829 / 0.917;
    const out = retargetClips(clips, map, hipsScale);
    const set = new Set(names);
    for (const c of out) {
      expect(c.tracks.length).toBe(defBones.length);
      for (const t of c.tracks) expect(set.has(t.name.slice(0, t.name.lastIndexOf('.')))).toBe(true);
      const hips = c.tracks.find((t) => t.name === 'pelvis.position')!;
      expect(Math.abs(hips.values[1] / 0.917 / hipsScale - 1)).toBeLessThan(0.001);
      expect(Math.abs(hips.values[4] / 0.9 / hipsScale - 1)).toBeLessThan(0.001);
    }
  });
  it('names: three strips the dots, both spellings map', () => {
    expect(ueNameFor('DEF-upper_arm.L')).toBe('upperarm_l');
    expect(ueNameFor('DEF-upper_armL')).toBe('upperarm_l');
    expect(ueNameFor('DEF-f_index.01.L')).toBe('index_01_l');
    expect(ueNameFor('DEF-thumb03R')).toBe('thumb_03_r');
    expect(ueNameFor('DEF-spine001')).toBe('spine_01');
    expect(ueNameFor('DEF-toeR')).toBe('ball_r');
    expect(ueNameFor('root')).toBeNull();
  });
});
