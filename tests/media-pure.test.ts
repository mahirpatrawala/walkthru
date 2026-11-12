// C9 acceptance 1-5, 14, 16 (pure part), 17. No tools needed.
import { describe, expect, it } from 'vitest';
import { cameraFromPose, coverage, parseImagesTxt, plyVertexCount, rankModels } from '../src/media/colmap-model';
import { dHash, hamming, laplacianVariance, selectEditorFrames } from '../src/media/frame-metrics';
import type { FrameMetric } from '../src/media/frame-metrics';
import { selectBubbles } from '../src/media/photo-pins-view';
import { isIdentityTransform, sanitiseFileName, suggestPinPose, validatePinsFile } from '../src/media/pins';
import type { PhotoPinsFile } from '../src/media/types';
import { tinyPly } from '../src/media/server/backends/fake';
import { quatFromAxisAngle } from '../src/core/geometry';
import { DEFAULT_FINISHES } from '../src/types';
import type { Layout } from '../src/types';

function checker(w: number, h: number, sq: number): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[y * w + x] = ((Math.floor(x / sq) + Math.floor(y / sq)) & 1) ? 230 : 25;
  return d;
}
function boxBlur(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0, c = 0;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && xx < w && yy >= 0 && yy < h) { s += src[yy * w + xx]; c++; }
      }
      out[y * w + x] = Math.round(s / c);
    }
  }
  return out;
}
/** smooth, tie-free test picture */
function field(w: number, h: number, dx = 0): Uint8Array {
  const d = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x - dx;
      const v = 128 + 60 * Math.sin(u * 0.047 + y * 0.011) + 40 * Math.cos(u * 0.021 - y * 0.063 + 1.3) + 25 * Math.sin(u * 0.009 * y * 0.1 + 0.4);
      d[y * w + x] = Math.max(0, Math.min(255, Math.round(v)));
    }
  }
  return d;
}

describe('C9 frame metrics', () => {
  it('1. laplacianVariance: checkerboard sharp, blurred soft, constant 0', () => {
    const sharp = checker(160, 120, 8);
    const soft = boxBlur(sharp, 160, 120, 4);
    const a = laplacianVariance(sharp, 160, 120);
    const b = laplacianVariance(soft, 160, 120);
    expect(a).toBeGreaterThan(20 * b);
    expect(laplacianVariance(new Uint8Array(160 * 120).fill(90), 160, 120)).toBe(0);
  });

  it('2. dHash: identical 0, 2 px shift at most 10, inverse exactly 64', () => {
    const img = field(160, 120);
    const h = dHash(img, 160, 120);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(hamming(h, dHash(field(160, 120), 160, 120))).toBe(0);
    expect(hamming(h, dHash(field(160, 120, 2), 160, 120))).toBeLessThanOrEqual(10);
    const inv = img.map((v) => 255 - v);
    expect(hamming(h, dHash(inv, 160, 120))).toBe(64);
  });

  it('3. selectEditorFrames: sharpest per second, duplicates dropped, capped at 60', () => {
    // seconds 3 to 5 share one hash; every other second has a hash far from its neighbours
    const hashes = ['0000000000000000', 'ffffffffffffffff', '0f0f0f0f0f0f0f0f', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa', 'aaaaaaaaaaaaaaaa',
      'f0f0f0f0f0f0f0f0', '00000000ffffffff', 'ffffffff00000000', '5555555555555555'];
    const metrics: FrameMetric[] = [];
    for (let i = 0; i < 100; i++) {
      const sec = Math.floor(i / 10);
      metrics.push({ index: i, timeSec: i / 10, sharpness: i % 10 === 3 ? 500 + sec : 10 + (i % 10), hash: hashes[sec] });
    }
    const chosen = selectEditorFrames(metrics);
    expect(chosen.length).toBe(8);
    expect(chosen.map((m) => Math.floor(m.timeSec))).toEqual([0, 1, 2, 3, 6, 7, 8, 9]);
    expect(chosen.every((m) => m.index % 10 === 3)).toBe(true);
    // 200 distinct seconds (neighbours far apart) -> exactly the 60 sharpest, in time order
    const many: FrameMetric[] = [];
    for (let s = 0; s < 200; s++) {
      many.push({ index: s, timeSec: s + 0.5, sharpness: 1 + ((s * 37) % 101), hash: s % 2 ? '0f0f0f0f0f0f0f0f' : 'f0f0f0f0f0f0f0f0' });
    }
    const sixty = selectEditorFrames(many);
    expect(sixty.length).toBe(60);
    for (let i = 1; i < sixty.length; i++) expect(sixty[i].timeSec).toBeGreaterThan(sixty[i - 1].timeSec);
    const minKept = Math.min(...sixty.map((m) => m.sharpness));
    expect(many.filter((m) => m.sharpness > minKept).length).toBeLessThanOrEqual(60);
  });
});

describe('C9 COLMAP model parsing', () => {
  const sq = Math.SQRT1_2;
  const txt = [
    '# Image list with two lines of data per image:',
    '#   IMAGE_ID, QW, QX, QY, QZ, TX, TY, TZ, CAMERA_ID, NAME',
    '#   POINTS2D[] as (X, Y, POINT3D_ID)',
    '# Number of images: 3',
    '1 1 0 0 0 0 0 -2 1 frame-000001.jpg',
    '10.5 20.5 -1 11.5 21.5 5',
    '2 1 0 0 0 1 2 3 1 frame-000002.jpg',
    '',
    `3 ${sq} 0 ${sq} 0 0 0 -2 1 frame-000003.jpg`,
    '1.0 2.0 7',
  ].join('\n');

  it('4. parseImagesTxt: names, centre, forward, a 90 degree yaw', () => {
    const ims = parseImagesTxt(txt);
    expect(ims.map((i) => i.name)).toEqual(['frame-000001.jpg', 'frame-000002.jpg', 'frame-000003.jpg']);
    const a = ims[0];
    expect(a.centre.x).toBeCloseTo(0); expect(a.centre.y).toBeCloseTo(0); expect(a.centre.z).toBeCloseTo(2);
    expect(a.forward.x).toBeCloseTo(0); expect(a.forward.y).toBeCloseTo(0); expect(a.forward.z).toBeCloseTo(1);
    // q = 90 degrees about Y, t = (0, 0, -2): R = [[0,0,1],[0,1,0],[-1,0,0]], centre = -R^T t = (-2, 0, 0), forward = row 3 of R = (-1, 0, 0)
    const b = ims[2];
    const c = cameraFromPose([sq, 0, sq, 0], [0, 0, -2]);
    expect(b.centre.x).toBeCloseTo(c.centre.x);
    expect(b.centre.x).toBeCloseTo(-2); expect(b.centre.y).toBeCloseTo(0); expect(b.centre.z).toBeCloseTo(0);
    expect(b.forward.x).toBeCloseTo(-1); expect(b.forward.y).toBeCloseTo(0); expect(b.forward.z).toBeCloseTo(0);
  });

  it('5. coverage: two runs at 10 fps over a 10 s video', () => {
    const times: number[] = [];
    for (let i = 0; i < 30; i++) times.push(i / 10);
    for (let i = 60; i < 75; i++) times.push(i / 10);
    const c = coverage(times, 100, 10, 10);
    expect(c.spans).toEqual([{ fromSec: 0, toSec: 3 }, { fromSec: 6, toSec: 7.5 }]);
    expect(c.secondsCovered).toBeCloseTo(4.5, 6);
    expect(c.registeredFrames).toBe(45);
    expect(c.totalFrames).toBe(100);
  });

  it('ranks models by registered image count and reads a PLY header', () => {
    expect(rankModels([{ registered: 5 }, { registered: 9 }, { registered: 9 }]).map((m) => m.registered)).toEqual([9, 9, 5]);
    expect(plyVertexCount(new Uint8Array(tinyPly(123)))).toBe(123);
    expect(plyVertexCount(new TextEncoder().encode('not a ply'))).toBeNull();
  });
});

const layout: Layout = {
  wallHeightM: 2.6, wallThicknessM: 0.12, railingHeightM: 1.1,
  rooms: [{ id: 'r', roomType: 'bedroom', label: 'Bedroom', polygon: [{ x: 0, z: 0 }, { x: 30, z: 0 }, { x: 30, z: 30 }, { x: 0, z: 30 }], edges: ['wall', 'wall', 'wall', 'wall'] }],
  openings: [], finishes: DEFAULT_FINISHES, scaleSource: 'typed-sizes',
};

describe('C9 pin pose suggestion', () => {
  const cams = [{ frame: 'frame-000010.jpg', timeSec: 1, centre: { x: 1, y: 2, z: 3 }, forward: { x: 0, y: 0, z: 1 } }];
  const match = { frame: 'media/frames/f-0001.jpg', timeSec: 1.2, score: 0.1 };

  it('14. a pinned splat moves the camera into the world; the identity does not', () => {
    const yaw90 = quatFromAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    const s = suggestPinPose({ id: 'p-001' }, match, cams,
      { file: 'scene.ply', format: 'ply', upPreset: 'flip-x', mode: 'overlay', transform: { rotation: yaw90, scale: 0.5, position: [10, 0, 20] } }, layout);
    // rotate (1, 3) by 90 deg about Y: (x cos + z sin, -x sin + z cos) = (3, -1); times 0.5 plus (10, 20)
    expect(s.source).toBe('frame-pose');
    expect(s.at!.x).toBeCloseTo(11.5, 6);
    expect(s.at!.z).toBeCloseTo(19.5, 6);
    expect(s.yawDeg).toBeCloseTo(90, 6); // raw heading 0 plus 90
    expect(s.roomId).toBe('r');
    const id = suggestPinPose({ id: 'p-001' }, match, cams,
      { file: 'scene.ply', format: 'ply', upPreset: 'flip-x', mode: 'overlay', transform: { rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] } }, layout);
    expect(id.source).toBe('frame-only');
    expect(id.at).toBeNull();
    expect(isIdentityTransform({ rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] })).toBe(true);
    expect(suggestPinPose({ id: 'p' }, { ...match, score: 0.5 }, cams, undefined, layout).source).toBe('none');
    expect(suggestPinPose({ id: 'p' }, null, cams, undefined, layout).source).toBe('none');
  });

  it('no camera within 0.5 s gives frame-only', () => {
    const far = { ...match, timeSec: 5 };
    const s = suggestPinPose({ id: 'p' }, far, cams,
      { file: 'scene.ply', format: 'ply', upPreset: 'flip-x', mode: 'overlay', transform: { rotation: [0, 0, 0, 1], scale: 0.5, position: [0, 0, 0] } }, layout);
    expect(s.source).toBe('frame-only');
  });
});

describe('C9 pins file and names', () => {
  const pin = (id: string, extra: Record<string, unknown> = {}) => ({
    id, file: `media/photos/${id}.jpg`, thumb: `media/photos/${id}.thumb.jpg`, width: 100, height: 80, at: null, yawDeg: null, roomId: null, placedBy: null, ...extra,
  });
  it('validates, round-trips and rejects duplicates and escapes', () => {
    const ok: PhotoPinsFile = { version: 1, pins: [pin('p-001'), pin('p-002', { at: { x: 1, z: 2 }, yawDeg: 90, placedBy: 'broker', caption: 'Hall' })] } as PhotoPinsFile;
    expect(validatePinsFile(JSON.parse(JSON.stringify(ok)))).toEqual(ok);
    expect(() => validatePinsFile({ version: 1, pins: [pin('p-001'), pin('p-001')] })).toThrow(/twice/);
    expect(() => validatePinsFile({ version: 1, pins: [pin('p-001', { file: '../../etc/passwd' })] })).toThrow(/media\/photos/);
    expect(() => validatePinsFile({ version: 1, pins: [pin('p-001', { thumb: 'media/photos/../x.jpg' })] })).toThrow();
    expect(() => validatePinsFile({ version: 1, pins: [pin('p-001', { caption: 'x'.repeat(61) })] })).toThrow(/60/);
    expect(() => validatePinsFile({ version: 2, pins: [] })).toThrow(/version/);
  });
  it('16. file names are reduced to a safe basename', () => {
    expect(sanitiseFileName('../../etc/passwd.mp4')).toBe('passwd.mp4');
    expect(sanitiseFileName('..\\..\\win dows\\a b.jpg')).toBe('a_b.jpg');
    expect(sanitiseFileName('....')).toBe('file');
    expect(sanitiseFileName('x'.repeat(200) + '.jpg').length).toBeLessThanOrEqual(80);
  });
});

describe('C9 buyer bubble selection', () => {
  it('17. at most 6, nearest first, each in room A or within 4 m', () => {
    // room A is x < 10; 10 pins at assorted spots
    const roomIdAt = (p: { x: number; z: number }) => (p.x < 10 ? 'A' : 'B');
    const spots = [[1, 1], [2, 5], [8, 8], [9, 1], [3, 3], [5, 9], [11, 2], [12, 2], [14, 5], [20, 20]];
    const pins = spots.map(([x, z], i) => ({ id: `p${i}`, at: { x, z } }));
    const viewer = { x: 4, z: 4 };
    const out = selectBubbles(pins, viewer, 'A', roomIdAt);
    expect(out.length).toBeLessThanOrEqual(6);
    expect(out.length).toBe(6);
    for (let i = 1; i < out.length; i++) expect(out[i].dist).toBeGreaterThanOrEqual(out[i - 1].dist);
    for (const o of out) {
      const p = pins.find((q) => q.id === o.id)!;
      expect(roomIdAt(p.at) === 'A' || Math.hypot(p.at.x - viewer.x, p.at.z - viewer.z) <= 4).toBe(true);
    }
    // a pin in room B 3 m away shows; one 6 m away in room B does not
    const edge = selectBubbles([{ id: 'near', at: { x: 11, z: 4 } }, { id: 'far', at: { x: 14, z: 4 } }], { x: 9, z: 4 }, 'A', roomIdAt);
    expect(edge.map((e) => e.id)).toEqual(['near']);
    // invisible pins are skipped
    expect(selectBubbles(pins, viewer, 'A', roomIdAt, (id) => id !== 'p4').some((o) => o.id === 'p4')).toBe(false);
  });
});
