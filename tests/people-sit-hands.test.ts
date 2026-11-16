// SPEC 16.6.11c: the library's sitting clip rests the hands inside our bodies' thighs; the sitting clips bend the elbows a little more.
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { SIT_ARM_DEG, SIT_ELBOW_DEG, sitHandsUp } from '../src/look/retarget';

const BONES = ['upperarm_l', 'upperarm_r', 'lowerarm_l', 'lowerarm_r'];
const rest = new Map(BONES.map((n) => [n, { name: n, parent: null, q: new THREE.Quaternion(), wq: new THREE.Quaternion(), wp: new THREE.Vector3(), parentWorld: new THREE.Matrix4() }]));
const clip = (name: string, d: number) => new THREE.AnimationClip(name, d, BONES.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, [0, d], [0, 0, 0, 1, 0, 0, 0, 1])));
const angleAt = (c: THREE.AnimationClip, bone: string, t: number): number => {
  const tr = c.tracks.find((k) => k.name === `${bone}.quaternion`)!;
  const v = ((tr as unknown as { createInterpolant(): { evaluate(t: number): ArrayLike<number> } }).createInterpolant()).evaluate(t);
  return (new THREE.Quaternion(v[0], v[1], v[2], v[3]).angleTo(new THREE.Quaternion()) * 180) / Math.PI;
};

describe('sitting hands (16.6.11c)', () => {
  const out = sitHandsUp([clip('Sitting_Idle_Loop', 1.5), clip('Sitting_Enter', 1.3), clip('Sitting_Exit', 1), clip('Walk_Loop', 1)], rest);
  const by = (n: string) => out.find((c) => c.name === n)!;
  it('the loop is lifted all through: elbows and upper arms bent more', () => {
    for (const t of [0, 0.7, 1.5]) {
      expect(angleAt(by('Sitting_Idle_Loop'), 'lowerarm_l', t)).toBeCloseTo(SIT_ELBOW_DEG, 0);
      expect(angleAt(by('Sitting_Idle_Loop'), 'upperarm_r', t)).toBeCloseTo(SIT_ARM_DEG, 0);
    }
    expect(by('Sitting_Idle_Loop').duration).toBe(1.5);
  });
  it('sitting down grows into the lift, getting up fades out of it, walking is untouched', () => {
    expect(angleAt(by('Sitting_Enter'), 'lowerarm_r', 0)).toBeLessThan(0.5);
    expect(angleAt(by('Sitting_Enter'), 'lowerarm_r', 1.3)).toBeCloseTo(SIT_ELBOW_DEG, 0);
    expect(angleAt(by('Sitting_Exit'), 'lowerarm_r', 0)).toBeCloseTo(SIT_ELBOW_DEG, 0);
    expect(angleAt(by('Sitting_Exit'), 'lowerarm_r', 1)).toBeLessThan(0.5);
    expect(angleAt(by('Walk_Loop'), 'lowerarm_l', 0.5)).toBeLessThan(0.01);
  });
  it('a rig without the arm bones is left alone', () => {
    const c = [clip('Sitting_Idle_Loop', 1)];
    expect(sitHandsUp(c, new Map())).toBe(c);
  });
});
