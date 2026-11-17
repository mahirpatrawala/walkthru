import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { HEAD_CENTRE_M, bedLayout } from '../src/core/bed-layout';
import { liePose, seatPose, standPose } from '../src/core/poses';
import { SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../src/types';
import type { FurnitureItem } from '../src/types';

const items = buildTruthProperty('furnished').furniture;
const bed = items.find((i) => i.kind === 'bed')!;
const sofa = items.find((i) => i.kind === 'sofa')!;

describe('liePose (acceptance)', () => {
  // the truth bed is one box 2.0 m long (no mattress size): the sleeping area starts 0.075 m in, clear of a headboard, and the crown lies 0.05 m inside it
  it('truth bed, H = 1.75, approach (2.5, 1.0): head x 0.125, feet x 1.875, z = 1.875 (the -Z half), yaw 90', () => {
    const p = liePose(bed, 1.75, { x: 2.5, z: 1.0 });
    console.log('liePose', JSON.stringify(p));
    expect(p.feet.x).toBeCloseTo(1.875, 6);
    expect(p.feet.z).toBeCloseTo(2.25 - 0.375, 6);
    expect(p.yawDeg).toBe(90);
    expect(p.surfaceY).toBe(0.55);
    // head = feet - a * H, a = (1, 0)
    expect(p.feet.x - 1.75).toBeCloseTo(0.125, 6);
  });
  it('takes the other half when the approach is on the other side', () => {
    const p = liePose(bed, 1.75, { x: 2.5, z: 3.5 });
    expect(p.feet.z).toBeCloseTo(2.25 + 0.375, 6);
  });
  it('lies along the centre line on a mattress narrower than 1.2 m', () => {
    const single: FurnitureItem = { ...bed, inner: { w: 0.91, d: 1.83 }, box: { cx: 1.0, cz: 2.25, w: 1.01, d: 1.93, yawDeg: 90 } };
    const p = liePose(single, 1.75, { x: 2.5, z: 1.0 });
    expect(p.feet.z).toBeCloseTo(2.25, 6);
    // the head line is 0.075 from the box end (the mattress starts at 0.05); the crown 0.05 inside it: head x = 1.0 - 0.965 + 0.125 = 0.16
    expect(p.feet.x - 1.75).toBeCloseTo(0.16, 6);
  });
  it('puts a 1.90 m person on a 2.00 m mattress with their feet at its foot, the head moved up toward the head end', () => {
    const p = liePose(bed, 1.9, { x: 2.5, z: 1.0 });
    // 0.125 + 1.9 would overhang the foot at 2.0: the crown moves up to 0.10 and the feet end at 2.0
    expect(p.feet.x).toBeCloseTo(2.0, 6);
  });
  it('the head is where the bed\'s pillow is (src/core/bed-layout.ts decides both)', () => {
    const L = bedLayout(bed.box, bed.inner);
    for (const [approachZ, k] of [[1.0, 0], [3.5, 1]] as const) {
      const p = liePose(bed, 1.75, { x: 2.5, z: approachZ });
      // bed-local: z along the bed from its centre (a = +x here), x across it (b = -z here)
      const headZ = p.feet.x - 1.75 - bed.box.cx + HEAD_CENTRE_M, headX = -(p.feet.z - bed.box.cz);
      const pl = L.pillows.find((q) => Math.abs(q.x - headX) < 1e-6)!;
      expect(pl, `side ${k}`).toBeTruthy();
      expect(Math.abs(headZ - pl.z)).toBeLessThan(pl.d / 2);
    }
    expect(L.pillows.length).toBe(2);
    expect(bedLayout({ w: 1.01, d: 1.93 }, { w: 0.91, d: 1.83 }).pillows.length).toBe(1);
  });
});

describe('seatPose (acceptance)', () => {
  it('truth sofa, approach (2.5, 3.0): yaw 270, hip at x = 3.55 - 0.15 = 3.40', () => {
    const s = seatPose(sofa, 1.75, { x: 2.5, z: 3.0 });
    const hipX = s.root.x + SIT_HIP_BACK_RATIO * 1.75; // root is in front (-x) of the hip
    console.log('seatPose', JSON.stringify(s), 'hip.x', hipX.toFixed(4));
    expect(s.yawDeg).toBe(270);
    expect(hipX).toBeCloseTo(3.4, 6);
    // lat = -0.5 is inside +-(1.0 - 0.35); b = (0, 1) so z = 3.5 - 0.5
    expect(s.root.z).toBeCloseTo(3.0, 6);
    expect(s.rootY).toBeCloseTo(Math.max(-0.02, 0.42 - SIT_SEAT_RATIO * 1.75), 6);
  });
  it('clamps the seat spot to 0.35 m inside the ends', () => {
    const s = seatPose(sofa, 1.75, { x: 2.5, z: 9 });
    expect(s.root.z).toBeCloseTo(3.5 + 0.65, 6);
    const t = seatPose(sofa, 1.75, { x: 2.5, z: -9 });
    expect(t.root.z).toBeCloseTo(3.5 - 0.65, 6);
  });
  it('never sinks the root more than 2 cm below the floor', () => {
    const low: FurnitureItem = { ...sofa, surfaceHeightM: 0.2 };
    expect(seatPose(low, 1.9, { x: 2, z: 3.5 }).rootY).toBe(-0.02);
  });
});

describe('standPose', () => {
  const counter: FurnitureItem = {
    id: 'c', source: 'real', kind: 'counter', label: 'Counter',
    box: { cx: 2, cz: 0.3, w: 2.4, d: 0.6, yawDeg: 0 }, heightM: 0.85, surfaceHeightM: 0.85,
  };
  it('stands 0.30 m in front of the item, facing it', () => {
    const s = standPose(counter, 1.75, { x: 1.5, z: 2 });
    expect(s.root.z).toBeCloseTo(0.3 + 0.3 + 0.3, 6);
    expect(s.root.x).toBeCloseTo(1.5, 6);
    expect(s.yawDeg).toBe(180);
  });
  it('clamps along the width with a 0.30 margin and wraps the yaw', () => {
    const s = standPose({ ...counter, box: { ...counter.box, yawDeg: 270 } }, 1.75, { x: 9, z: 9 });
    expect(s.yawDeg).toBe(90);
    const t = standPose(counter, 1.75, { x: 99, z: 2 });
    expect(t.root.x).toBeCloseTo(2 + 1.2 - 0.3, 6);
  });
});
