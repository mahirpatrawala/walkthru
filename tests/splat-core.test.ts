// C7 acceptance (SPEC 9, C7) on the synthetic fragment from scripts/make-test-room.ts.
import { describe, expect, it } from 'vitest';
import { TRUTH, buildSplatFragment, encodePly, rawFromTruth } from '../scripts/make-test-room';
import { parsePly, parseSplat } from '../src/core/splat/files';
import { levelFromThreePoints, levelFromTransform, levelSplat, toLevelled } from '../src/core/splat/floor';
import { alignSplat, alignSplatByDistance, placeSplat, placementFromPairs, placementFromTransform, scanToWorld, worldToScan } from '../src/core/splat/align';
import { pickSurfacePoint, worldRayToRaw } from '../src/core/splat/pick';
import { renderPlanImage, suggestPxPerUnit } from '../src/core/splat/plan-image';
import { rotateY } from '../src/core/geometry';
import type { LevelResult, RawCloud, SceneTransform, Vec3 } from '../src/types';

const frag = buildSplatFragment();
const cloud = frag.cloud;
const ply = encodePly(frag);
const dist = (a: Vec3, b: Vec3): number => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

/** p_world = scale * rotate(rotation, p_raw) + position */
function apply(t: SceneTransform, p: Vec3): Vec3 {
  const r = rotateY(t.rotation, p);
  return { x: t.scale * r.x + t.position[0], y: t.scale * r.y + t.position[1], z: t.scale * r.z + t.position[2] };
}
const levelledOf = (level: LevelResult, p: Vec3): Vec3 => {
  const r = rotateY(level.rotation, p);
  return { x: r.x, y: r.y - level.floorOffsetRaw, z: r.z };
};

describe('files', { timeout: 60_000 }, () => {
  it('parsePly round-trips the fragment: count, positions float-exact, opacity byte, colour', () => {
    const c = parsePly(ply);
    expect(c.count).toBe(cloud.count);
    let posDiff = 0;
    for (let i = 0; i < c.positions.length; i++) if (c.positions[i] !== cloud.positions[i]) posDiff++;
    expect(posDiff).toBe(0);
    let worstOp = 0, worstCol = 0;
    for (let i = 0; i < c.count; i++) {
      worstOp = Math.max(worstOp, Math.abs(c.opacity[i] - cloud.opacity[i]));
      for (let k = 0; k < 3; k++) worstCol = Math.max(worstCol, Math.abs(c.rgb[i * 3 + k] - cloud.rgb[i * 3 + k]));
    }
    expect(c.opacity[0]).toBeGreaterThanOrEqual(241);
    expect(c.opacity[0]).toBeLessThanOrEqual(243);
    expect(worstOp).toBeLessThanOrEqual(1);
    expect(worstCol).toBeLessThanOrEqual(2);
    // the first patch is the bedroom floor, colour 0.72 0.58 0.42
    console.log(`[C7] parsePly: ${c.count} splats, max opacity diff ${worstOp}, max colour diff ${worstCol}, opacity[0]=${c.opacity[0]}`);
  });
  it('parsePly reads the sh1 variant and rejects compressed, ASCII and truncated files', () => {
    const small = { cloud: { count: 2, positions: cloud.positions.slice(0, 6), opacity: cloud.opacity.slice(0, 2), rgb: cloud.rgb.slice(0, 6) }, scales: frag.scales.slice(0, 6), rotations: frag.rotations.slice(0, 8) };
    const sh = parsePly(encodePly(small, { sh1: true }));
    expect(sh.count).toBe(2);
    expect(Array.from(sh.positions)).toEqual(Array.from(small.cloud.positions));
    const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
    expect(() => parsePly(enc('ply\nformat binary_little_endian 1.0\nelement chunk 1\nproperty float min_x\nelement vertex 1\nproperty uint packed_position\nend_header\n'))).toThrow(/compressed/i);
    expect(() => parsePly(enc('ply\nformat ascii 1.0\nelement vertex 0\nproperty float x\nproperty float y\nproperty float z\nend_header\n'))).toThrow(/little-endian/);
    expect(() => parsePly(ply.subarray(0, ply.length - 50))).toThrow(/cut short/);
    expect(() => parsePly(enc('not a ply'))).toThrow();
  });
  it('parseSplat reads 32-byte records', () => {
    const b = new Uint8Array(64);
    const dv = new DataView(b.buffer);
    dv.setFloat32(0, 1.5, true); dv.setFloat32(4, -2, true); dv.setFloat32(8, 3.25, true);
    b.set([10, 20, 30, 200], 24);
    dv.setFloat32(32, 7, true);
    b.set([1, 2, 3, 4], 56);
    const c = parseSplat(b);
    expect(c.count).toBe(2);
    expect(Array.from(c.positions.slice(0, 3))).toEqual([1.5, -2, 3.25]);
    expect(Array.from(c.rgb.slice(0, 3))).toEqual([10, 20, 30]);
    expect(c.opacity[0]).toBe(200);
    expect(c.positions[3]).toBe(7);
    expect(c.opacity[1]).toBe(4);
  });
});

describe('levelSplat', { timeout: 60_000 }, () => {
  const level = levelSplat(cloud, 'flip-x');
  it('clean fragment, flip-x: tilt 3.0 +- 0.3, floor at 0 +- 0.04, ceiling 2.60 +- 0.03 m, confident', () => {
    // floor truth points, mapped to raw, then levelled
    const ys: number[] = [];
    for (let x = 0.1; x < 4; x += 0.2) for (let z = 0.1; z < 5; z += 0.2) ys.push(levelledOf(level, rawFromTruth({ x, y: 0, z })).y);
    ys.sort((a, b) => a - b);
    const med = ys[ys.length >> 1];
    console.log(`[C7] clean flip-x: tilt ${level.tiltDeg.toFixed(3)} deg, floor median ${med.toFixed(4)} raw, floorOffsetRaw ${level.floorOffsetRaw.toFixed(3)}, ceilingRaw ${level.ceilingRaw?.toFixed(3)} (x0.37 = ${((level.ceilingRaw ?? 0) * 0.37).toFixed(3)} m), confidence ${level.confidence.toFixed(1)}, lowConfidence ${level.lowConfidence}`);
    expect(Math.abs(level.tiltDeg - 3)).toBeLessThanOrEqual(0.3);
    expect(Math.abs(med)).toBeLessThanOrEqual(0.04);
    expect(level.ceilingRaw).not.toBeNull();
    expect(Math.abs(level.ceilingRaw! * 0.37 - 2.6)).toBeLessThanOrEqual(0.03);
    expect(level.lowConfidence).toBe(false);
  });
  it('degraded fragment: same floor (within 0.06 raw), not the mirrored ceiling, tilt 3.0 +- 0.5', () => {
    const d = buildSplatFragment({ degraded: true }).cloud;
    const r = levelSplat(d, 'flip-x');
    const ys: number[] = [];
    for (let x = 0.1; x < 4; x += 0.2) for (let z = 0.1; z < 5; z += 0.2) ys.push(levelledOf(r, rawFromTruth({ x, y: 0, z })).y);
    ys.sort((a, b) => a - b);
    const med = ys[ys.length >> 1];
    const ceilTruthY = levelledOf(r, rawFromTruth({ x: 2, y: 2.6, z: 2.5 })).y;
    console.log(`[C7] degraded flip-x: tilt ${r.tiltDeg.toFixed(3)} deg, floor median ${med.toFixed(4)} raw, floorOffsetRaw ${r.floorOffsetRaw.toFixed(3)} (clean ${level.floorOffsetRaw.toFixed(3)}), ceilingRaw ${r.ceilingRaw?.toFixed(3)}, true ceiling at ${ceilTruthY.toFixed(3)}, confidence ${r.confidence.toFixed(1)}, lowConfidence ${r.lowConfidence}`);
    expect(Math.abs(r.floorOffsetRaw - level.floorOffsetRaw)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(med)).toBeLessThanOrEqual(0.06);
    expect(Math.abs(r.tiltDeg - 3)).toBeLessThanOrEqual(0.5);
    // the floor was not taken to be the (upside-down) mirrored ceiling
    expect(med).toBeGreaterThan(-0.06);
    expect(r.ceilingRaw).not.toBeNull();
    expect(Math.abs(r.ceilingRaw! * 0.37 - 2.6)).toBeLessThanOrEqual(0.05);
  });
  it('wrong preset (as-is) does not pass as a good floor at the same height: documented', () => {
    const r = levelSplat(cloud, 'as-is');
    // in the as-is frame the true floor is the highest surface and the true ceiling the lowest
    const trueFloorY = levelledOf(r, rawFromTruth({ x: 2, y: 0, z: 2.5 })).y;
    const trueCeilY = levelledOf(r, rawFromTruth({ x: 2, y: 2.6, z: 2.5 })).y;
    console.log(`[C7] as-is (wrong) : tilt ${r.tiltDeg.toFixed(2)} deg, floorOffsetRaw ${r.floorOffsetRaw.toFixed(3)} (right answer ${level.floorOffsetRaw.toFixed(3)}), ceilingRaw ${r.ceilingRaw}, confidence ${r.confidence.toFixed(1)}, lowConfidence ${r.lowConfidence}; levelled height of the true floor ${trueFloorY.toFixed(2)}, of the true ceiling ${trueCeilY.toFixed(2)}`);
    // Documented behaviour: with the scan upside down, the true ceiling is the lowest big plane and the true floor the highest.
    // levelSplat takes the lowest big plane (the ceiling, at levelled height ~0) as "floor" and the true floor as the "ceiling" (~2.6 m up).
    // The room still looks like a plausible room, so confidence stays above 3 and lowConfidence is FALSE: the wrong preset is NOT caught
    // by geometry alone. The editor therefore shows the levelled scan and the broker confirms it; see the C7 report.
    expect(Math.abs(trueCeilY)).toBeLessThan(0.1);
    expect(Math.abs(trueFloorY)).toBeGreaterThan(1);
    expect(Math.abs(r.floorOffsetRaw - level.floorOffsetRaw)).toBeGreaterThan(1);
  });
  it('a floor tilted past 15 degrees is refused by default (tilt reported, lowConfidence) and found when the guard is raised', () => {
    // add 25 degrees of roll about raw Z, as COLMAP output levelled to a pitched first camera would have
    const a = (25 * Math.PI) / 180, c = Math.cos(a), sn = Math.sin(a);
    const rot = (p: Vec3): Vec3 => ({ x: c * p.x - sn * p.y, y: sn * p.x + c * p.y, z: p.z });
    const positions = new Float32Array(cloud.positions.length);
    for (let i = 0; i < cloud.count; i++) {
      const r = rot({ x: cloud.positions[i * 3], y: cloud.positions[i * 3 + 1], z: cloud.positions[i * 3 + 2] });
      positions[i * 3] = r.x; positions[i * 3 + 1] = r.y; positions[i * 3 + 2] = r.z;
    }
    const tilted: RawCloud = { ...cloud, positions };
    const refused = levelSplat(tilted, 'flip-x', { maxTiltDeg: 15 }); // explicit old guard; default is now 30
    expect(refused.lowConfidence).toBe(true);
    expect(refused.tiltDeg).toBeGreaterThan(15);
    expect(refused.ceilingRaw).toBeNull();
    const ok = levelSplat(tilted, 'flip-x', { maxTiltDeg: 45 });
    const ys: number[] = [];
    for (let x = 0.1; x < 4; x += 0.2) for (let z = 0.1; z < 5; z += 0.2) ys.push(levelledOf(ok, rot(rawFromTruth({ x, y: 0, z }))).y);
    ys.sort((p, q) => p - q);
    console.log(`[C7] 25 deg extra roll: default guard -> tilt ${refused.tiltDeg.toFixed(2)}, low ${refused.lowConfidence}; maxTiltDeg 45 -> tilt ${ok.tiltDeg.toFixed(2)}, floor median ${ys[ys.length >> 1].toFixed(4)}, ceilingRaw*0.37 ${((ok.ceilingRaw ?? 0) * 0.37).toFixed(3)}, low ${ok.lowConfidence}`);
    expect(ok.lowConfidence).toBe(false);
    expect(Math.abs(ys[ys.length >> 1])).toBeLessThanOrEqual(0.04);
    expect(Math.abs(ok.tiltDeg - refused.tiltDeg)).toBeLessThan(0.5);
    expect(Math.abs((ok.ceilingRaw ?? 0) * 0.37 - 2.6)).toBeLessThanOrEqual(0.05);
  });
  it('a sparse or empty cloud is low confidence, not a crash', () => {
    const empty: RawCloud = { count: 0, positions: new Float32Array(0), opacity: new Uint8Array(0), rgb: new Uint8Array(0) };
    expect(levelSplat(empty, 'flip-x').lowConfidence).toBe(true);
  });
});

describe('levelFromThreePoints', () => {
  it('levels from three floor picks, normal turned toward the hint, confidence 99', () => {
    const raw = (x: number, z: number): Vec3 => rawFromTruth({ x, y: 0, z });
    const camera = rawFromTruth({ x: 2, y: 1.6, z: 2.5 });
    const r = levelFromThreePoints(raw(0.5, 0.5), raw(3.5, 0.7), raw(1.0, 4.5), camera);
    expect(r.confidence).toBe(99);
    expect(r.lowConfidence).toBe(false);
    for (const [x, z] of [[0.5, 0.5], [3.5, 4.5], [2, 2.5]]) expect(Math.abs(levelledOf(r, raw(x, z)).y)).toBeLessThan(1e-3);
    // camera above the floor: the camera is at a positive levelled height
    expect(levelledOf(r, camera).y).toBeGreaterThan(1);
    // the hint on the other side flips the normal, so the floor is still at 0 but the camera is below
    const r2 = levelFromThreePoints(raw(0.5, 0.5), raw(3.5, 0.7), raw(1.0, 4.5), rawFromTruth({ x: 2, y: -1.6, z: 2.5 }));
    expect(levelledOf(r2, camera).y).toBeLessThan(-1);
    expect(() => levelFromThreePoints(raw(0, 0), raw(1, 1), raw(2, 2), camera)).toThrow(/line/);
  });
});

describe('alignSplat', { timeout: 60_000 }, () => {
  const level = levelSplat(cloud, 'flip-x');
  const [j1, j2] = TRUTH.doorJambs;
  const pins = (): [{ scan: { x: number; z: number }; world: { x: number; z: number } }, { scan: { x: number; z: number }; world: { x: number; z: number } }] => {
    const s1 = levelledOf(level, rawFromTruth(j1)), s2 = levelledOf(level, rawFromTruth(j2));
    return [{ scan: { x: s1.x, z: s1.z }, world: { x: j1.x, z: j1.z } }, { scan: { x: s2.x, z: s2.z }, world: { x: j2.x, z: j2.z } }];
  };
  it('two door jambs: scale 0.37 +- 0.5 %, every landmark within 0.03 m', () => {
    const t = alignSplat(level, pins());
    let worst = 0;
    for (const lm of TRUTH.landmarks) worst = Math.max(worst, dist(apply(t, rawFromTruth(lm)), lm));
    console.log(`[C7] alignSplat: scale ${t.scale.toFixed(5)} (${((t.scale / 0.37 - 1) * 100).toFixed(3)} %), worst landmark error ${(worst * 100).toFixed(2)} cm`);
    expect(Math.abs(t.scale / 0.37 - 1)).toBeLessThanOrEqual(0.005);
    expect(worst).toBeLessThanOrEqual(0.03);
  });
  it('the placement helpers agree with alignSplat and invert each other', () => {
    const pl = placementFromPairs(pins());
    const t = alignSplat(level, pins());
    const t2 = placeSplat(level, pl);
    expect(t2.scale).toBeCloseTo(t.scale, 12);
    expect(t2.position[0]).toBeCloseTo(t.position[0], 9);
    expect(t2.position[1]).toBeCloseTo(t.position[1], 9);
    const back = placementFromTransform(t, level);
    expect(back.theta).toBeCloseTo(pl.theta, 6);
    expect(back.tx).toBeCloseTo(pl.tx, 9);
    const p = { x: 1.2, z: -3.4 };
    const w = scanToWorld(pl, p);
    const p2 = worldToScan(pl, w);
    expect(p2.x).toBeCloseTo(p.x, 9);
    expect(p2.z).toBeCloseTo(p.z, 9);
    // pins land exactly
    expect(scanToWorld(pl, pins()[1].scan).x).toBeCloseTo(j2.x, 9);
    // a saved transform is itself a levelling: re-pinning against it gives the same world points
    const lv2 = levelFromTransform(t);
    const q = apply(t, rawFromTruth({ x: 3, y: 0.4, z: 1 }));
    const l2 = levelledOf(lv2, rawFromTruth({ x: 3, y: 0.4, z: 1 }));
    expect(l2.y * t.scale).toBeCloseTo(q.y, 6);
    expect(() => placementFromPairs([pins()[0], pins()[0]])).toThrow(/same spot/);
  });
  it('alignSplatByDistance: scale from one typed distance, centre to the origin', () => {
    const [a, b] = pins();
    const centre = { x: 3, z: -2 };
    const t = alignSplatByDistance(level, a.scan, b.scan, 0.9, centre);
    expect(Math.abs(t.scale / 0.37 - 1)).toBeLessThanOrEqual(0.005);
    const lvlPoint: Vec3 = { x: centre.x, y: 0, z: centre.z };
    // invert level.rotation to get a raw point whose levelled position is `centre`
    const q = level.rotation;
    const raw = rotateY([-q[0], -q[1], -q[2], q[3]], { x: lvlPoint.x, y: level.floorOffsetRaw, z: lvlPoint.z });
    const o = apply(t, raw);
    expect(Math.hypot(o.x, o.y, o.z)).toBeLessThan(1e-4);
  });
});

describe('pickSurfacePoint', { timeout: 60_000 }, () => {
  it('a ray from the room centre toward the middle of the wall x = 4 lands within 0.03 m of the wall', () => {
    const o = rawFromTruth({ x: 2, y: 1.3, z: 2.5 });
    const target = rawFromTruth({ x: 4, y: 1.3, z: 2.5 });
    const d = { x: target.x - o.x, y: target.y - o.y, z: target.z - o.z };
    const hit = pickSurfacePoint(cloud.positions, cloud.opacity, o, d);
    expect(hit).not.toBeNull();
    // back to true metres: invert p_raw = R0 p / 0.37 + o via the known truth map
    const probe = (p: Vec3): Vec3 => rawFromTruth(p);
    const e0 = probe({ x: 0, y: 0, z: 0 }), ex = probe({ x: 1, y: 0, z: 0 }), ey = probe({ x: 0, y: 1, z: 0 }), ez = probe({ x: 0, y: 0, z: 1 });
    const cols = [ex, ey, ez].map((e) => ({ x: (e.x - e0.x) * 0.37, y: (e.y - e0.y) * 0.37, z: (e.z - e0.z) * 0.37 }));
    const rel = { x: (hit!.x - e0.x) * 0.37, y: (hit!.y - e0.y) * 0.37, z: (hit!.z - e0.z) * 0.37 };
    // R0 is orthonormal (columns cols), so true = R0^T * rel
    const truth = { x: cols[0].x * rel.x + cols[0].y * rel.y + cols[0].z * rel.z, y: cols[1].x * rel.x + cols[1].y * rel.y + cols[1].z * rel.z, z: cols[2].x * rel.x + cols[2].y * rel.y + cols[2].z * rel.z };
    console.log(`[C7] pickSurfacePoint hit true-frame (${truth.x.toFixed(3)}, ${truth.y.toFixed(3)}, ${truth.z.toFixed(3)}), wall at x = 4`);
    expect(Math.abs(truth.x - 4)).toBeLessThanOrEqual(0.03);
    expect(Math.abs(truth.y - 1.3)).toBeLessThanOrEqual(0.05);
  });
  it('a ray into empty space returns null; worldRayToRaw inverts a scene transform', () => {
    const o = { x: 100, y: 100, z: 100 };
    expect(pickSurfacePoint(cloud.positions, cloud.opacity, o, { x: 0, y: 1, z: 0 })).toBeNull();
    const level = levelSplat(cloud, 'flip-x');
    const t = placeSplat(level, { s: 0.37, theta: 0.4, tx: 1, tz: -2 });
    const rawP = { x: 4, y: -3, z: 6 };
    const w = apply(t, rawP);
    const r = worldRayToRaw(t, { x: w.x, y: w.y, z: w.z }, { x: 0, y: 0, z: 1 });
    expect(r.origin.x).toBeCloseTo(rawP.x, 4);
    expect(r.origin.y).toBeCloseTo(rawP.y, 4);
    expect(r.origin.z).toBeCloseTo(rawP.z, 4);
    expect(Math.hypot(r.dir.x, r.dir.y, r.dir.z)).toBeCloseTo(1, 9);
  });
});

describe('renderPlanImage', { timeout: 60_000 }, () => {
  const level = levelSplat(cloud, 'flip-x');
  const img = renderPlanImage(cloud, level, suggestPxPerUnit(cloud, level, 150));
  const px = (rawP: Vec3): [number, number, number, number] => {
    const l = levelledOf(level, rawP);
    const i = Math.floor((l.x - img.originX) / img.unitsPerPx), j = Math.floor((l.z - img.originZ) / img.unitsPerPx);
    expect(i).toBeGreaterThanOrEqual(0); expect(i).toBeLessThan(img.width);
    expect(j).toBeGreaterThanOrEqual(0); expect(j).toBeLessThan(img.height);
    const k = (j * img.width + i) * 4;
    return [img.rgba[k], img.rgba[k + 1], img.rgba[k + 2], img.rgba[k + 3]];
  };
  const dc = (p: number[], c: number[]): number => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]);
  it('the bed centre is closer to the bed colour than to the floor colour; outside the room is transparent', () => {
    const bed = [0.25, 0.4, 0.7].map((v) => v * 255), floor = [0.72, 0.58, 0.42].map((v) => v * 255);
    const atBed = px(rawFromTruth({ x: 1.0, y: 0.55, z: 2.25 }));
    expect(atBed[3]).toBe(255);
    console.log(`[C7] plan image ${img.width}x${img.height}; bed pixel ${atBed.slice(0, 3)}; distance to bed ${dc(atBed, bed).toFixed(1)}, to floor ${dc(atBed, floor).toFixed(1)}`);
    expect(dc(atBed, bed)).toBeLessThan(dc(atBed, floor));
    const atFloor = px(rawFromTruth({ x: 2.0, y: 0, z: 1.0 }));
    expect(dc(atFloor, floor)).toBeLessThan(dc(atFloor, bed));
    // the levelled frame has an arbitrary yaw, so the bounding box has empty corners: all four are outside the room
    const corners = [[0, 0], [img.width - 1, 0], [0, img.height - 1], [img.width - 1, img.height - 1]];
    const transparent = corners.filter(([i, j]) => img.rgba[(j * img.width + i) * 4 + 3] === 0).length;
    expect(transparent).toBeGreaterThanOrEqual(2);
    // a pixel in the dead middle of the room is opaque, and the ceiling (0.97 white) is not what shows there
    const mid = px(rawFromTruth({ x: 2.4, y: 0, z: 4.0 }));
    expect(mid[3]).toBe(255);
    expect(mid[0]).toBeLessThan(240);
  });
  it('toLevelled puts the floor at 0', () => {
    const lv = toLevelled(cloud, level);
    expect(lv.length).toBe(cloud.count * 3);
    const l = levelledOf(level, cloud.positions.subarray(0, 3).reduce((a, _, i, arr) => (i === 0 ? { x: arr[0], y: arr[1], z: arr[2] } : a), { x: 0, y: 0, z: 0 }));
    expect(lv[1]).toBeCloseTo(l.y, 4);
  });
});
