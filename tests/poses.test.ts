import { describe, expect, it } from 'vitest';
import { buildTruthProperty } from '../scripts/make-test-room';
import { liePose, seatPose, standPose } from '../src/core/poses';
import { SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../src/types';
import type { FurnitureItem } from '../src/types';

const items = buildTruthProperty('furnished').furniture;
const bed = items.find((i) => i.kind === 'bed')!;
const sofa = items.find((i) => i.kind === 'sofa')!;

describe('liePose (acceptance)', () => {
  it('truth bed, H = 1.75, approach (2.5, 1.0): head x 0.05, feet x 1.80, z = 1.875 (the -Z half), yaw 90', () => {
    const p = liePose(bed, 1.75, { x: 2.5, z: 1.0 });
    console.log('liePose', JSON.stringify(p));
    expect(p.feet.x).toBeCloseTo(1.8, 6);
    expect(p.feet.z).toBeCloseTo(2.25 - 0.375, 6);
    expect(p.yawDeg).toBe(90);
    expect(p.surfaceY).toBe(0.55);
    // head = feet - a * H, a = (1, 0)
    expect(p.feet.x - 1.75).toBeCloseTo(0.05, 6);
  });
  it('takes the other half when the approach is on the other side', () => {
    const p = liePose(bed, 1.75, { x: 2.5, z: 3.5 });
    expect(p.feet.z).toBeCloseTo(2.25 + 0.375, 6);
  });
  it('lies along the centre line on a mattress narrower than 1.2 m', () => {
    const single: FurnitureItem = { ...bed, inner: { w: 0.91, d: 1.83 }, box: { cx: 1.0, cz: 2.25, w: 1.01, d: 1.93, yawDeg: 90 } };
    const p = liePose(single, 1.75, { x: 2.5, z: 1.0 });
    expect(p.feet.z).toBeCloseTo(2.25, 6);
    // headInset = (1.93 - 1.83) / 2 + 0.05 = 0.10; head x = 1.0 - (0.965 - 0.10) = 0.135
    expect(p.feet.x - 1.75).toBeCloseTo(0.135, 6);
  });
  it('puts a 1.90 m person on a 2.00 m mattress with 10 cm to spare at the foot', () => {
    const p = liePose(bed, 1.9, { x: 2.5, z: 1.0 });
    // feet at 0.05 + 1.9 = 1.95, the mattress ends at 2.0
    expect(p.feet.x).toBeCloseTo(1.95, 6);
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
