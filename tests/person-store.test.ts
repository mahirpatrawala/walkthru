// SPEC 16.6.6 check 6 and the retargeting fixture (check 5).
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_PERSON, PERSON_KEY, VIEW_KEY, loadPerson, loadView, normalisePerson, savePerson, saveView } from '../src/buyer/person-store';
import { HEIGHT_KEY } from '../src/buyer/store';
import { buildNameMap, retargetClips, ueNameFor } from '../src/look/retarget';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m };
};

describe('person state (check 6)', () => {
  it('defaults to the man, tone 2, 175', () => {
    expect(loadPerson(mem())).toEqual({ body: 'man', tone: 2, heightCm: 175 });
    expect(DEFAULT_PERSON).toEqual({ body: 'man', tone: 2, heightCm: 175 });
  });
  it('migrates the old height key once', () => {
    const s = mem({ [HEIGHT_KEY]: '190' });
    expect(loadPerson(s)).toEqual({ body: 'man', tone: 2, heightCm: 190 });
    savePerson(s, { body: 'woman', tone: 4, heightCm: 160 });
    expect(loadPerson(s)).toEqual({ body: 'woman', tone: 4, heightCm: 160 }); // the person key wins afterwards
  });
  it('clamps out-of-range values', () => {
    expect(normalisePerson({ body: 'woman', tone: 9, heightCm: 300 })).toEqual({ body: 'woman', tone: 4, heightCm: 190 });
    expect(normalisePerson({ body: 'x', tone: -3, heightCm: 100 })).toEqual({ body: 'man', tone: 0, heightCm: 150 });
    // every person has a range of their own: a child may be 90 cm, an elder cannot be 200
    expect(normalisePerson({ body: 'child', tone: 2, heightCm: 80 })).toEqual({ body: 'child', tone: 2, heightCm: 90 });
    expect(normalisePerson({ body: 'child', tone: 2, heightCm: 175 })).toEqual({ body: 'child', tone: 2, heightCm: 150 });
    expect(normalisePerson({ body: 'elder', tone: 2, heightCm: 200 })).toEqual({ body: 'elder', tone: 2, heightCm: 180 });
    // version 1 stored 'male' and 'female'
    expect(normalisePerson({ body: 'female', tone: 1, heightCm: 165 })).toEqual({ body: 'woman', tone: 1, heightCm: 165 });
    expect(normalisePerson({ body: 'male', tone: 1, heightCm: 180 })).toEqual({ body: 'man', tone: 1, heightCm: 180 });
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

describe('view: see yourself or first person (SPEC 16.6.8)', () => {
  it('is third person (see yourself) until the viewer chooses, and remembers the choice per viewer', () => {
    const s = mem();
    expect(loadView(s)).toBe('third');
    saveView(s, 'first');
    expect(s.m.get(VIEW_KEY)).toBe('first');
    expect(loadView(s)).toBe('first');
    saveView(s, 'third');
    expect(loadView(s)).toBe('third');
  });
  it('reads junk, missing or blocked storage as the default, and does not touch the person key', () => {
    expect(loadView(mem({ [VIEW_KEY]: 'sideways' }))).toBe('third');
    expect(loadView(null)).toBe('third');
    expect(() => saveView(null, 'first')).not.toThrow();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
    expect(loadView(throwing)).toBe('third');
    expect(() => saveView(throwing, 'first')).not.toThrow();
    const s = mem();
    saveView(s, 'first');
    expect(s.m.has(PERSON_KEY)).toBe(false);
  });
});

describe('garment tints read as cloth, not skin (16 Nov 2026)', () => {
  it('every height tint is at least 40 degrees of hue from every skin tone,', async () => {
    const { HEIGHT_TINTS } = await import('../src/types');
    const { SKIN_TONES, fabricColour } = await import('../src/look/people-materials');
    const hsl = (c: THREE.Color) => { const o = { h: 0, s: 0, l: 0 }; c.getHSL(o, THREE.SRGBColorSpace); return o; };
    for (const tint of HEIGHT_TINTS) {
      const t = hsl(fabricColour(tint));
      for (const skin of SKIN_TONES) {
        const s = hsl(new THREE.Color(skin));
        const dh = Math.min(Math.abs(t.h - s.h), 1 - Math.abs(t.h - s.h)) * 360;
        expect(dh, `${tint} against ${skin}`).toBeGreaterThanOrEqual(40);
      }
    }
  });
});
