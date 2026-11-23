// The Views (SPEC 2.10): set views of a flat, composed from its own layout. On the real flats, without a browser: the list is the same every time,
// every view stands inside its room, clear of furniture and walls, does not face a wall within 1.5 m and keeps the main piece in frame; the counts
// are in range; the tabs group baths and balconies with the room they open off; the address, the override, the plan's dots and the panorama contract.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { pointInPolygon } from '../src/core/geometry';
import { validateProperty } from '../src/core/layout-validate';
import { FACE_MIN_M, FRAME_HALF_DEG, MAX_VIEWS, checkViewpoint, composeViewpoints, groupIntoTabs, listLabel, tabsOf } from '../src/buyer/viewpoints/compose';
import type { ComposeInput, Viewpoint } from '../src/buyer/viewpoints/compose';
import { viewpointsFromSpec } from '../src/buyer/viewpoints/override';
import { resolveViewpoints } from '../src/buyer/viewpoints/resolve';
import { RING_APART_M, inSight, movePlan, parseVpParam, planMarks, poseAt, ringRadiusM, ringTargets, stepView } from '../src/buyer/viewpoints/model';
import { PANO_NOTE, attachPanos, exportList, panoColumn, panoDirection, panoManifestUrl, panosFromManifest, parsePano, posesForRenderer, unmatchedPanos } from '../src/buyer/viewpoints/pano';
import { buildShareUrl } from '../src/buyer/share';
import { planSvg } from '../src/start/plan-svg';
import { DoorSim, loadScene } from './helpers/nav-sim';
import type { PropertyFile } from '../src/types';

const A3 = 'test-tower-flat-3bhk-a';
const B2 = 'test-tower-flat-2bhk-b2';

const inputOf = (p: PropertyFile): ComposeInput => ({ layout: p.layout, furniture: p.furniture, grid: stampFurniture(rasterizeLayout(p.layout), p.furniture) });

/** every home in the repository with two whole rooms or more (the Views are mounted for these) */
const HOMES = fs.readdirSync(path.join(__dirname, '..', 'public', 'scenes')).filter((id) => {
  const f = path.join(__dirname, '..', 'public', 'scenes', id, 'property.json');
  if (!fs.existsSync(f)) return false;
  const p = validateProperty(JSON.parse(fs.readFileSync(f, 'utf8')));
  return (p.spaceKind ?? 'home') === 'home' && p.layout.rooms.filter((r) => !r.partial).length >= 2 && !fs.existsSync(path.join(__dirname, '..', 'public', 'scenes', id, 'outdoor.json'));
});
const cache = new Map<string, { p: PropertyFile; input: ComposeInput; views: Viewpoint[] }>();
const of = (id: string): { p: PropertyFile; input: ComposeInput; views: Viewpoint[] } => {
  let c = cache.get(id);
  if (!c) { const p = loadScene(id); const input = inputOf(p); c = { p, input, views: composeViewpoints(input) }; cache.set(id, c); }
  return c;
};
const bedrooms = (p: PropertyFile): number => p.layout.rooms.filter((r) => r.roomType === 'bedroom' && !/servant|maid|store/i.test(r.label)).length;

describe('composing the views of a flat', () => {
  it('is deterministic: the same flat gives the same list', () => {
    for (const id of [A3, B2]) {
      const { input, views } = of(id);
      expect(composeViewpoints(input)).toEqual(views);
      expect(composeViewpoints({ ...input, furniture: [...input.furniture] })).toEqual(views);
    }
  });

  it.each(HOMES)('%s: every view is inside its room, clear, not facing a wall, with the main piece in frame', (id) => {
    const { input, views } = of(id);
    const bad: string[] = [];
    for (const v of views) {
      const c = checkViewpoint(v, input);
      if (!c.inside) bad.push(`${v.id} is not inside its room`);
      if (c.clearM < 0.3) bad.push(`${v.id} stands ${c.clearM} m from a wall or a piece`);
      if (c.faceM < FACE_MIN_M) bad.push(`${v.id} faces a wall ${c.faceM.toFixed(2)} m away`);
      if (v.subjectId && (c.subjectOffDeg === null || c.subjectOffDeg > FRAME_HALF_DEG + 0.01 || !c.subjectSeen)) bad.push(`${v.id} loses its piece (${c.subjectOffDeg?.toFixed(1)} deg, seen ${c.subjectSeen})`);
      if (v.eyeM < 1.5 || v.eyeM > 1.6) bad.push(`${v.id} eye ${v.eyeM}`);
    }
    // a room with a main piece (bed, sofa, dining table, kitchen counter) keeps one in frame in every view
    const main = (roomId: string): boolean => input.furniture.some((f) => pointInPolygon({ x: f.box.cx, z: f.box.cz }, input.layout.rooms.find((r) => r.id === roomId)!.polygon) && (f.kind === 'bed' || f.kind === 'dining' || (f.kind === 'sofa' && !/ottoman|pouf|stool|armchair|chair/i.test(f.label))));
    for (const v of views) {
      const room = input.layout.rooms.find((r) => r.id === v.roomId)!;
      if ((room.roomType === 'bedroom' || room.roomType === 'living') && main(room.id) && !v.subjectId) bad.push(`${v.id} has no piece in frame`);
    }
    expect(bad).toEqual([]);
  });

  it.each(HOMES)('%s: a count in range, unique ids, honest names', (id) => {
    const { p, views } = of(id);
    const b = bedrooms(p);
    const [lo, hi] = b >= 3 ? [12, MAX_VIEWS] : b === 2 ? [7, 15] : [2, 12];
    expect(views.length).toBeGreaterThanOrEqual(lo);
    expect(views.length).toBeLessThanOrEqual(hi);
    expect(new Set(views.map((v) => v.id)).size).toBe(views.length);
    for (const v of views) {
      const room = p.layout.rooms.find((r) => r.id === v.roomId)!;
      expect(v.id).toMatch(new RegExp(`^${v.roomId}-\\d+$`));
      expect(v.name).toBe(`${room.label} · ${v.phrase}`);
      // the words come from a short list (and the layout's own names): nothing the layout does not show
      expect(v.phrase).toMatch(/^(from the entrance|looking out|towards the windows?|towards the [a-z0-9 -]+|from the door|from the doorway|from the [a-z0-9 -]+|from the corner|across the room)$/);
    }
    // names are unique in a room
    for (const r of p.layout.rooms) { const n = views.filter((v) => v.roomId === r.id).map((v) => v.phrase); expect(new Set(n).size).toBe(n.length); }
  });

  it('the 3 BHK gets 12 to 18 views and the 2 BHK fewer; the front door gives the first', () => {
    const a = of(A3).views, b = of(B2).views;
    expect(a.length).toBeGreaterThanOrEqual(12);
    expect(a.length).toBeLessThanOrEqual(18);
    expect(b.length).toBeLessThan(a.length);
    expect(a[0].kind).toBe('entrance');
    expect(a[0].name).toBe('Living · from the entrance');
    // the 2 BHK's front door opens into a narrow foyer that shows a slot of the home between two walls: no entrance view there (never padded)
    expect(b.some((v) => v.kind === 'entrance' || v.roomId === 'foyer')).toBe(false);
    // no passage has a view; a bath gets one at most
    for (const { views, p } of [of(A3), of(B2)]) {
      for (const r of p.layout.rooms) {
        const n = views.filter((v) => v.roomId === r.id).length;
        if (/passage/i.test(r.label)) expect(n).toBe(0);
        if (r.roomType === 'bathroom') expect(n).toBeLessThanOrEqual(1);
      }
    }
    // the master bedroom has two or three, a balcony looks out
    expect(a.filter((v) => v.roomId === 'master-bedroom').length).toBeGreaterThanOrEqual(2);
    // the balcony is seen along itself, its chairs and railing, not a frame of open sky
    expect(a.find((v) => v.roomId === 'balcony')).toBeDefined();
  });
});

describe('room tabs, Navigo\'s way', () => {
  it('lists a bath and a balcony under the room they open off, and keeps every view once', () => {
    const { p, views } = of(A3);
    const tabs = tabsOf(views);
    const tabOf = (roomId: string): string | undefined => tabs.find((t) => t.roomIds.includes(roomId))?.id;
    expect(tabOf('master-toilet')).toBe(tabOf('master-bedroom'));
    expect(tabOf('balcony')).toBe(tabOf('living'));
    expect(tabOf('dining')).toBe(tabOf('living')); // living rooms open to each other are one tab
    expect(tabs.flatMap((t) => t.viewIds).sort()).toEqual(views.map((v) => v.id).sort());
    // the list is in tab order: prev and next go room by room
    const order = views.map((v) => v.tabId);
    for (let i = 1; i < order.length; i++) if (order[i] !== order[i - 1]) expect(order.slice(i).includes(order[i - 1])).toBe(false);
    // the tab's own views by their phrase, another room's by its full name
    const living = tabs.find((t) => t.id === tabOf('living'))!;
    expect(listLabel(views[0], living)).toBe('From the entrance');
    const bal = views.find((v) => v.roomId === 'balcony')!;
    expect(listLabel(bal, living)).toBe(`Balcony · ${bal.phrase}`);
    void p;
  });
});

describe('the address, the share link and stepping', () => {
  it('reads vp= and writes it when the walker stands at a view', () => {
    expect(parseVpParam('?scene=x&vp=living-1')).toBe('living-1');
    expect(parseVpParam('?vp=<script>')).toBeNull();
    expect(parseVpParam('?scene=x')).toBeNull();
    const url = buildShareUrl({ href: 'https://a.test/?scene=x', at: { x: 1, z: 2, yawDeg: 30 }, cam: 'first', vp: 'living-1' });
    expect(new URL(url).searchParams.get('vp')).toBe('living-1');
    expect(new URL(buildShareUrl({ href: 'https://a.test/?scene=x&vp=old', at: { x: 1, z: 2, yawDeg: 30 }, cam: 'first' })).searchParams.get('vp')).toBeNull();
    // every id of a generated list is one the address can name
    for (const v of of(A3).views) expect(parseVpParam(`?vp=${v.id}`)).toBe(v.id);
  });
  it('steps next and previous round the list', () => {
    const v = of(B2).views;
    expect(stepView(v, null, 1)?.id).toBe(v[0].id);
    expect(stepView(v, v[0].id, 1)?.id).toBe(v[1].id);
    expect(stepView(v, v[0].id, -1)?.id).toBe(v[v.length - 1].id);
  });
  it('glides when the eye can see the way, fades through a wall, cuts with reduced motion', () => {
    const a = { x: 0, y: 1.6, z: 0, yawDeg: 0, pitchDeg: 0 }, b = { x: 3, y: 1.6, z: 0, yawDeg: 90, pitchDeg: 5 };
    expect(movePlan(a, b, true, false).mode).toBe('glide');
    expect(movePlan(a, b, false, false).mode).toBe('fade');
    expect(movePlan(a, b, true, true)).toEqual({ mode: 'cut', seconds: 0 });
    const g = movePlan(a, b, true, false).seconds;
    expect(g).toBeGreaterThanOrEqual(0.6); expect(g).toBeLessThanOrEqual(1.5);
    expect(poseAt(a, b, 0)).toEqual(a);
    expect(poseAt(a, b, 1).x).toBeCloseTo(3);
    expect(poseAt({ ...a, yawDeg: 350 }, { ...b, yawDeg: 10 }, 0.5).yawDeg).toBeCloseTo(360); // the short way round
  });
});

describe('rings in the scene', () => {
  it('shows the nearest few views in sight, never one behind a wall, sized for distance', () => {
    const { input, views, p } = of(A3);
    // every door shut, as the page has them at first: a shut leaf ends a sight line like a wall
    const shut = new DoorSim(p.layout, input.grid).stamp(input.grid);
    for (const at of views) {
      const r = ringTargets(views, at, at.id, shut);
      expect(r.length).toBeLessThanOrEqual(4);
      expect(r.map((v) => v.id)).not.toContain(at.id);
      // nearest first, each one really in sight, and never in a room behind a shut door
      const ds = r.map((v) => Math.hypot(v.x - at.x, v.z - at.z));
      expect([...ds].sort((a, b) => a - b)).toEqual(ds);
      for (const v of r) expect(inSight(shut, at, v)).toBe(true);
      if (at.roomId === 'master-bedroom') for (const v of r) expect(['master-bedroom', 'master-toilet'].includes(v.roomId)).toBe(true);
      // never two rings on top of each other
      for (const [i, v] of r.entries()) for (const w of r.slice(i + 1)) expect(Math.hypot(v.x - w.x, v.z - w.z)).toBeGreaterThanOrEqual(RING_APART_M);
    }
    // two views side by side are one ring, the nearer
    const twin = { ...views[1], id: 'twin', x: views[1].x + 0.4 };
    const r2 = ringTargets([...views, twin], views[0], views[0].id, input.grid);
    expect(r2.filter((v) => v.id === 'twin' || v.id === views[1].id)).toHaveLength(r2.some((v) => v.id === views[1].id || v.id === 'twin') ? 1 : 0);
    // in an open-plan living and dining room the other views of the room are rung
    const ent = views[0];
    expect(ringTargets(views, ent, ent.id, shut).some((v) => v.roomId === 'living' || v.roomId === 'dining')).toBe(true);
    expect(ringRadiusM(1)).toBeLessThan(ringRadiusM(6));
    expect(ringRadiusM(50)).toBeLessThanOrEqual(0.5);
  });
});

describe('the plan\'s dots', () => {
  it('are the views: one dot per view, at its point, inside its room and on the plan', () => {
    for (const id of [A3, B2]) {
      const { p, views } = of(id);
      const marks = planMarks(views);
      expect(marks.map((m) => m.id)).toEqual(views.map((v) => v.id));
      const pic = planSvg(p.layout, {}, { idPrefix: 't', selectedId: null, title: 't' });
      const vb = /viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/.exec(pic.svg)!.slice(1).map(Number);
      marks.forEach((m, i) => {
        expect(m.x).toBe(views[i].x); expect(m.z).toBe(views[i].z); expect(m.label).toBe(views[i].name);
        expect(m.x).toBeGreaterThan(vb[0]); expect(m.x).toBeLessThan(vb[0] + vb[2]);
        expect(m.z).toBeGreaterThan(vb[1]); expect(m.z).toBeLessThan(vb[1] + vb[3]);
        expect(pointInPolygon(m, p.layout.rooms.find((r) => r.id === views[i].roomId)!.polygon)).toBe(true);
      });
    }
  });
});

describe('an authored list replaces the generated one', () => {
  it('uses the list as given, in its order, and leaves out what it cannot use', () => {
    const p = loadScene(B2);
    const spec = [
      { id: 'hero', name: 'Living and dining · the hero shot', x: 1.5, z: 3.5, yawDeg: 180, pitchDeg: 5 },
      { x: 7.5, z: 4.5, yawDeg: 90 },
      { x: 50, z: 50, yawDeg: 0 },
      { name: 'no numbers' },
    ];
    const r = resolveViewpoints({ layout: p.layout, furniture: p.furniture, override: spec });
    expect(r.source).toBe('authored');
    expect(r.views.map((v) => v.id).sort()).toEqual(['hero', 'master-bedroom-1']);
    expect(r.views.find((v) => v.id === 'hero')).toMatchObject({ roomId: 'living-dining', phrase: 'the hero shot', yawDeg: 180, pitchDeg: 5, eyeM: 1.55, source: 'authored' });
    expect(r.views.find((v) => v.id === 'master-bedroom-1')?.name).toBe('Master bedroom');
    expect(r.warnings.length).toBe(2);
    // no list: the generated views
    expect(resolveViewpoints({ layout: p.layout, furniture: p.furniture }).views).toEqual(of(B2).views);
    // an empty list is an override too
    expect(viewpointsFromSpec([], p.layout)?.views).toEqual([]);
    expect(viewpointsFromSpec(undefined, p.layout)).toBeNull();
    // the scene file keeps the list (validateProperty passes it through)
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'scenes', B2, 'property.json'), 'utf8'));
    expect(validateProperty({ ...raw, viewpoints: spec }).viewpoints).toEqual(spec);
  });
  it('groups authored views into tabs like generated ones', () => {
    const p = loadScene(A3);
    const g = groupIntoTabs(p.layout, [{ id: 'x', roomId: 'master-toilet', roomLabel: 'Master toilet', phrase: 'a', name: 'Master toilet · a', x: 7.4, z: 4.5, eyeM: 1.55, yawDeg: 0, pitchDeg: 0, kind: 'authored', source: 'authored' }]);
    expect(g.tabs[0].label).toBe('Master bedroom');
  });
});

// ---------------------------------------------------------------- the panorama contract, with a synthetic picture

/** A 2:1 picture whose red channel is the column (0..255 left to right) and green the row: a gradient, not a render. */
function gradientPng(w: number, h: number): { png: Buffer; at(u: number, v: number): [number, number, number] } {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = Math.round((x / (w - 1)) * 255); raw[o + 1] = Math.round((y / (h - 1)) * 255); raw[o + 2] = 128; }
  }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer): number => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer): Buffer => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  // read it back, as a picture loader would
  const inflated = zlib.inflateSync(png.subarray(33 + 8, png.length - 12 - 4));
  const at = (u: number, v: number): [number, number, number] => {
    const x = Math.min(w - 1, Math.max(0, Math.round(u * (w - 1)))), y = Math.min(h - 1, Math.max(0, Math.round(v * (h - 1))));
    const o = y * (w * 3 + 1) + 1 + x * 3;
    return [inflated[o], inflated[o + 1], inflated[o + 2]];
  };
  return { png, at };
}

describe('a 360 degree picture of a view', () => {
  it('attaches by id, lands with its middle on the heading and its right half to the right, and exports the camera', () => {
    const { views } = of(B2);
    const v = views[1];
    const pic = gradientPng(256, 128);
    const url = `data:image/png;base64,${pic.png.toString('base64')}`;
    const panos = { [v.id]: { url, x: v.x, y: v.eyeM, z: v.z, yawDeg: v.yawDeg }, nope: { url, x: 0, y: 0, z: 0, yawDeg: 0 }, [views[2].id]: { url: 'javascript:alert(1)', x: 0, y: 1.5, z: 0, yawDeg: 0 } };
    const withPics = attachPanos(views, panos, '/scenes/x/');
    expect(withPics.filter((w) => w.pano).map((w) => w.id)).toEqual([v.id]);
    const pano = withPics[1].pano!;
    expect(pano.url).toBe(url);
    expect(parsePano({ url: 'panos/a.jpg', x: 1, y: 1.55, z: 2, yawDeg: 400 }, '/scenes/x/')).toEqual({ url: '/scenes/x/panos/a.jpg', x: 1, y: 1.55, z: 2, yawDeg: 40 });
    // the heading's column is the middle of the picture; a quarter turn to the right is three quarters across; behind is the seam
    const red = (dirYaw: number): number => pic.at(panoColumn(dirYaw, pano.yawDeg), 0.5)[0] / 255;
    expect(red(pano.yawDeg)).toBeCloseTo(0.5, 1);
    expect(red(pano.yawDeg - 90)).toBeCloseTo(0.75, 1); // right of (sin y, cos y) is the heading y - 90 (SPEC 3.1)
    expect(red(pano.yawDeg + 90)).toBeCloseTo(0.25, 1);
    // and the sphere the page draws shows that column in that direction
    const dirOf = (u: number): number => { const d = panoDirection(u, 0.5, pano.yawDeg); return (Math.atan2(d.x, d.z) * 180) / Math.PI; };
    const wrap = (a: number): number => ((((a + 180) % 360) + 360) % 360) - 180;
    expect(Math.abs(wrap(dirOf(0.5) - pano.yawDeg))).toBeLessThan(1e-6);
    expect(Math.abs(wrap(dirOf(0.75) - (pano.yawDeg - 90)))).toBeLessThan(1e-6);
    expect(panoDirection(0.5, 0, pano.yawDeg).y).toBeCloseTo(1); // the top row is straight up
    // what a renderer reads: id, room, the camera (x, y = eye height, z) and the heading
    const ex = exportList(withPics);
    expect(ex[1]).toMatchObject({ id: v.id, room: v.roomLabel, x: v.x, y: v.eyeM, z: v.z, yawDeg: v.yawDeg, pitchDeg: v.pitchDeg });
    expect(ex.length).toBe(views.length);
  });
});

describe("the renderer's manifest (npm run pano: panos/manifest.json)", () => {
  // the shape the panorama renderer writes (version 1), ids from `export-viewpoints --poses`
  const manifestFor = (views: readonly Viewpoint[], extra: Record<string, unknown>[] = []): Record<string, unknown> => ({
    version: 1, sceneId: B2, label: 'Illustrative render', projection: 'equirectangular', centre: 'yaw', renderer: 'Blender Cycles',
    panos: [
      ...views.slice(0, 2).map((v) => ({ id: v.id, x: v.x, y: 1.58, z: v.z, yaw: v.yawDeg, pitch: -v.pitchDeg, label: v.name, file: `${v.id}.jpg`, mobile: `${v.id}.m.jpg`, width: 4096, height: 2048 })),
      ...extra,
    ],
  });

  it('attaches each picture to the view of its id, the phone file on a phone, the label as the note, and names the strays', () => {
    const { views } = of(B2);
    const raw = manifestFor(views, [{ id: 'balcony', x: 1, y: 1.58, z: 1, yaw: 10, file: 'balcony.jpg', mobile: 'balcony.m.jpg', width: 2048, height: 1024 }]);
    const base = `/scenes/${B2}/`;
    expect(panoManifestUrl(base)).toBe(`/scenes/${B2}/panos/manifest.json`);
    const desk = panosFromManifest(raw, base, { mobile: false });
    expect(desk.warnings).toEqual([]);
    expect(desk.panos[views[0].id]).toEqual({ url: `/scenes/${B2}/panos/${views[0].id}.jpg`, x: views[0].x, y: 1.58, z: views[0].z, yawDeg: views[0].yawDeg, note: 'Illustrative render' });
    expect(panosFromManifest(raw, base, { mobile: true }).panos[views[1].id].url).toBe(`/scenes/${B2}/panos/${views[1].id}.m.jpg`);
    expect(unmatchedPanos(views, desk.panos)).toEqual(['balcony']);
    const withPics = attachPanos(views, desk.panos);
    expect(withPics.filter((w) => w.pano).map((w) => w.id)).toEqual([views[0].id, views[1].id]);
    expect(withPics[0].pano?.note).toBe('Illustrative render');
    // a manifest without a label still says what it is
    const { label: _l, ...noLabel } = raw;
    expect(panosFromManifest(noLabel, base, { mobile: false }).panos[views[0].id].note).toBe(PANO_NOTE);
  });

  it('reads only an equirectangular, yaw-centred version 1 manifest, and only bare file names in its folder', () => {
    const { views } = of(B2);
    const base = `/scenes/${B2}/`;
    expect(panosFromManifest({ ...manifestFor(views), version: 2 }, base, { mobile: false })).toMatchObject({ panos: {}, warnings: [expect.stringMatching(/version 2/)] });
    expect(Object.keys(panosFromManifest({ ...manifestFor(views), projection: 'cubemap' }, base, { mobile: false }).panos)).toEqual([]);
    expect(Object.keys(panosFromManifest(null, base, { mobile: false }).panos)).toEqual([]);
    const bad = panosFromManifest(manifestFor([], [
      { id: 'a', x: 0, y: 1.5, z: 0, yaw: 0, file: '../../secret.jpg' },
      { id: 'b', x: 0, y: 1.5, z: 0, yaw: 0, file: 'https://elsewhere.example/b.jpg' },
      { id: 'c', x: 0, y: 1.5, z: 0, yaw: 0, file: 'c.jpg', width: 1000, height: 1000 },
      { id: 'd', y: 1.5, z: 0, yaw: 0, file: 'd.jpg' },
      { id: 'e', x: 0, y: 1.5, z: 0, yaw: 0, file: 'e.webp' },
    ]), base, { mobile: false });
    expect(Object.keys(bad.panos)).toEqual(['e']);
    expect(bad.warnings).toHaveLength(4);
  });

  it('gives the renderer poses with the views\' ids, the eye height and its up-positive pitch', () => {
    const { views } = of(A3);
    const poses = posesForRenderer(views);
    expect(poses.map((p) => p.id)).toEqual(views.map((v) => v.id));
    for (const [i, p] of poses.entries()) {
      expect(p.pitch).toBeCloseTo(-views[i].pitchDeg, 2);
      expect(p.y).toBeCloseTo(views[i].eyeM, 2);
      expect(p.yaw).toBeCloseTo(views[i].yawDeg, 2);
      expect(p.label).toBe(views[i].name);
    }
  });
});
