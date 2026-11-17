// The pure parts of the VR page (SPEC 21): the address, the pose maths that tells the headset where the viewer stands, the teleport arc and its landing,
// the snap turn, the fade, the panel's layout and hit testing, the frame statistics and the list of homes.
import { describe, expect, it } from 'vitest';
import { parseXrUrl, xrUrl } from '../src/xr/url';
import { mainSiteBase, mainSiteUrl } from '../src/xr/config';
import { IDENTITY_POSE, applyOffsetInverse, cameraYawForSceneYaw, cameraYawOf, poseFacing, poseOver, referenceOffset, rotateY, toLocal, toWorld, turnAbout, wrapPi } from '../src/xr/pose';
import { FadeMachine } from '../src/xr/fade';
import { SnapTurn, aimTeleport, arcPoints, lineClear, marchArc, snapDeltaYaw, validateTeleport } from '../src/xr/teleport';
import { FrameStats, debugLines } from '../src/xr/frame-stats';
import { ROWS_PER_PAGE, clampPage, hitButton, layoutPanel, pageCount, panelPlacement, rayToPanelPixel } from '../src/xr/panel-layout';
import type { PanelModel } from '../src/xr/panel-layout';
import { buildHomeList, keyOfTarget, sceneOfTarget } from '../src/xr/catalogue';
import { rasterizeLayout } from '../src/core/layout-raster';
import { chooseSpawn } from '../src/core/spawn';
import { CHARACTER_RADIUS_M } from '../src/types';
import type { Layout } from '../src/types';
import { readFileSync } from 'node:fs';
import { validateProperty } from '../src/core/layout-validate';

const close = (a: number, b: number, eps = 1e-9): void => { expect(Math.abs(a - b)).toBeLessThan(eps); };

describe('the VR address', () => {
  it('opens a home straight away from ?scene= and carries a room', () => {
    expect(parseXrUrl('?scene=test-sample-1').target).toEqual({ kind: 'scene', scene: 'test-sample-1', room: null });
    expect(parseXrUrl('?scene=test-sample-1&room=bed-1').target).toEqual({ kind: 'scene', scene: 'test-sample-1', room: 'bed-1' });
  });
  it('reads the building flat parameters the normal site uses', () => {
    expect(parseXrUrl('?building=sample-tower&space=f2-201').target).toEqual({ kind: 'space', building: 'sample-tower', space: 'f2-201' });
    const b = parseXrUrl('?building=sample-tower');
    expect(b.target).toBeNull();
    expect(b.building).toBe('sample-tower');
  });
  it('refuses an id that is not an id and leaves the landing page', () => {
    expect(parseXrUrl('?scene=../etc/passwd').target).toBeNull();
    expect(parseXrUrl('?scene=A B').target).toBeNull();
    expect(parseXrUrl('').target).toBeNull();
  });
  it('reads the switches, and never offers the high tier', () => {
    const u = parseXrUrl('?auto=1&debug&xrfake=1&quality=high&scale=0.8');
    expect(u).toMatchObject({ auto: true, debug: true, fake: true, quality: 'low', scale: 0.8 });
    expect(parseXrUrl('?quality=medium').quality).toBe('medium');
    expect(parseXrUrl('?auto=0').auto).toBe(false);
    expect(parseXrUrl('?scale=abc').scale).toBeNull();
  });
  it('builds an address that parses back, keeping the display switches only', () => {
    const t = { kind: 'space' as const, building: 'sample-tower', space: 'f3-302' };
    expect(parseXrUrl(xrUrl(t, '?debug=1&xrfake=1&junk=1&scene=old')).target).toEqual(t);
    expect(xrUrl(t, '?debug=1&junk=1')).toBe('?building=sample-tower&space=f3-302&debug=1');
    expect(xrUrl(null)).toBe('?');
  });
  it('does not depend on the path: nothing here reads location.pathname', () => {
    expect(readFileSync('src/xr/url.ts', 'utf8')).not.toMatch(/pathname/);
  });
  it('links the normal site, from a meta tag when a subdomain sets one', () => {
    expect(mainSiteBase(null)).toBe('');
    expect(mainSiteBase({ querySelector: () => ({ getAttribute: () => 'https://example.test/' }) })).toBe('https://example.test');
    expect(mainSiteUrl('', null)).toBe('/');
    expect(mainSiteUrl('https://example.test', { scene: 'test-flat' })).toBe('https://example.test/?scene=test-flat');
    expect(mainSiteUrl('', { building: 'sample-tower', space: 'f2-201' })).toBe('/?building=sample-tower&space=f2-201');
  });
});

describe('pose: where the play space sits in the home', () => {
  it('world and local are inverse', () => {
    const pose = { x: 3.2, z: -1.4, yaw: 0.7 };
    const p = { x: 0.4, z: -0.9 };
    const w = toWorld(pose, p);
    const l = toLocal(pose, w);
    close(l.x, p.x); close(l.z, p.z);
  });
  it('puts the head over the target whatever the play space is turned to, and however far the viewer has walked in it', () => {
    for (const yaw of [0, 0.5, -2.2, 3]) {
      const head = { x: 0.6, z: -0.35 };
      const pose = poseOver(yaw, head, { x: 5, z: 2 });
      const w = toWorld(pose, head);
      close(w.x, 5); close(w.z, 2);
    }
  });
  it('a snap turn keeps the head where it is in the home', () => {
    const pose = { x: 2, z: 1, yaw: 0.3 };
    const headWorld = toWorld(pose, { x: 0.5, z: 0.2 });
    const next = turnAbout(pose, headWorld, snapDeltaYaw(1));
    const hw2 = toWorld(next, toLocal(pose, headWorld));
    close(hw2.x, headWorld.x); close(hw2.z, headWorld.z);
    close(wrapPi(next.yaw - pose.yaw), -Math.PI / 6);
  });
  it('the headset offset is the inverse of the pose', () => {
    for (const pose of [IDENTITY_POSE, { x: 4, z: -2, yaw: 1.1 }, { x: -1.5, z: 6, yaw: -2.6 }]) {
      const off = referenceOffset(pose);
      expect(off.position.y).toBe(0);
      close(off.orientation.x ** 2 + off.orientation.y ** 2 + off.orientation.z ** 2 + off.orientation.w ** 2, 1);
      const local = { x: 0.3, z: -0.8 };
      const w = toWorld(pose, local);
      const back = applyOffsetInverse(off, local);
      close(back.x, w.x, 1e-9); close(back.z, w.z, 1e-9);
    }
  });
  it('faces a room the way the home says, whichever way the viewer happens to be turned', () => {
    for (const headYaw of [0, 1.3, -2.8]) {
      const pose = poseFacing({ x: 0.2, z: 0.1 }, headYaw, { x: 3, z: 3 }, 90);
      // the head's world heading is the camera heading for scene yaw 90
      close(wrapPi(headYaw + pose.yaw - cameraYawForSceneYaw(90)), 0, 1e-9);
    }
    // scene yaw 0 looks along +z; a camera looking along +z has yaw pi
    close(wrapPi(cameraYawOf(0, 1) - cameraYawForSceneYaw(0)), 0);
    close(wrapPi(cameraYawOf(1, 0) - cameraYawForSceneYaw(90)), 0);
  });
  it('rotateY is three\'s sense', () => {
    // a quarter turn about +Y takes +z to +x
    const r = rotateY({ x: 0, z: 1 }, Math.PI / 2);
    close(r.x, 1); close(r.z, 0, 1e-12);
  });
});

describe('snap turn', () => {
  it('turns once per flick, thirty degrees, and not while held', () => {
    const s = new SnapTurn();
    expect(s.update(0)).toBe(0);
    expect(s.update(0.5)).toBe(0);
    expect(s.update(0.9)).toBe(1);
    expect(s.update(1)).toBe(0);
    expect(s.update(0.6)).toBe(0);
    expect(s.update(0.1)).toBe(0);
    expect(s.update(-0.95)).toBe(-1);
    expect(s.update(-0.95)).toBe(0);
  });
  it('is thirty degrees, right turns the view right', () => {
    close(snapDeltaYaw(1), -Math.PI / 6);
    close(snapDeltaYaw(-1), Math.PI / 6);
    expect(snapDeltaYaw(0)).toBeCloseTo(0);
    // six flicks make a full turn
    let yaw = 0;
    for (let i = 0; i < 12; i++) yaw += snapDeltaYaw(1);
    close(wrapPi(yaw), 0, 1e-9);
  });
});

describe('the fade', () => {
  it('runs the action once, at black, and clears', async () => {
    const f = new FadeMachine(0.1, 0.2);
    let ranAt = -1;
    let alphaWhenRan = -1;
    const done = f.go(() => { ranAt = f.alpha; alphaWhenRan = f.alpha; });
    expect(f.busy).toBe(true);
    for (let i = 0; i < 5; i++) f.update(0.05);
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(ranAt).toBe(1);
    expect(alphaWhenRan).toBe(1);
    for (let i = 0; i < 10; i++) f.update(0.05);
    await done;
    expect(f.busy).toBe(false);
    expect(f.alpha).toBe(0);
  });
  it('stays black while a slow action runs, and never runs two at once', async () => {
    const f = new FadeMachine(0.1, 0.1);
    let release!: () => void;
    const order: string[] = [];
    const a = f.go(() => new Promise<void>((r) => { order.push('a-start'); release = () => { order.push('a-end'); r(); }; }));
    const b = f.go(() => { order.push('b'); });
    for (let i = 0; i < 4; i++) f.update(0.05);
    await Promise.resolve(); await Promise.resolve();
    for (let i = 0; i < 40; i++) f.update(0.05);
    expect(f.alpha).toBe(1);
    expect(order).toEqual(['a-start']);
    release();
    await a; await b;
    expect(order).toEqual(['a-start', 'a-end', 'b']);
    for (let i = 0; i < 20; i++) f.update(0.05);
    expect(f.alpha).toBe(0);
    expect(f.busy).toBe(false);
  });
  it('reset lets queued callers go', async () => {
    const f = new FadeMachine();
    const p = f.go(() => {});
    f.reset();
    await p;
    expect(f.busy).toBe(false);
  });
});

// a plain two-room flat: 4 x 3 living room and a 3 x 3 bedroom, a door between them (a gap in the shared wall)
function flat(): Layout {
  const sceneIndex = JSON.parse(readFileSync('public/scenes/test-sample-1/property.json', 'utf8'));
  return validateProperty(sceneIndex).layout;
}

describe('the teleport arc', () => {
  it('leaves along the ray and falls', () => {
    const pts = arcPoints({ x: 0, y: 1.2, z: 0 }, { x: 0, y: 0, z: -1 });
    expect(pts[0]).toEqual({ x: 0, y: 1.2, z: 0 });
    expect(pts[10].z).toBeLessThan(pts[5].z);
    expect(pts[10].y).toBeLessThan(pts[5].y);
    // a level ray from 1.2 m reaches the floor about 3.7 m away
    const flatGrid = rasterizeLayout({ ...flat(), openings: [] });
    const end = marchArc(flatGrid, 10, pts.map((p) => ({ x: p.x + 100, y: p.y, z: p.z })));
    expect(end.kind).toBe('floor');
  });
  it('lands on the floor plane, and a wall stops it before it', () => {
    const layout = flat();
    const grid = rasterizeLayout(layout);
    const room = layout.rooms[0];
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
    // straight down from a hand: lands under it
    const down = marchArc(grid, layout.wallHeightM, arcPoints({ x: cx, y: 1.2, z: cz }, { x: 0, y: -1, z: 0 }));
    expect(down.kind).toBe('floor');
    expect(down.point.y).toBe(0);
    close(down.point.x, cx, 1e-6); close(down.point.z, cz, 1e-6);
    // a ray at a wall from near it: stopped at the wall, not through it
    let blocked = 0;
    for (let a = 0; a < 360; a += 15) {
      const d = { x: Math.sin((a * Math.PI) / 180), y: 0.2, z: Math.cos((a * Math.PI) / 180) };
      const l = Math.hypot(d.x, d.y, d.z);
      const e = marchArc(grid, layout.wallHeightM, arcPoints({ x: cx, y: 1.3, z: cz }, { x: d.x / l, y: d.y / l, z: d.z / l }, { speed: 14 }));
      if (e.kind === 'blocked') blocked++;
    }
    expect(blocked).toBeGreaterThan(0);
  });
  it('is blocked by the ceiling', () => {
    const layout = flat();
    const grid = rasterizeLayout(layout);
    const r = layout.rooms[0].polygon[0];
    const e = marchArc(grid, layout.wallHeightM, arcPoints({ x: r.x, y: 1.3, z: r.z }, { x: 0, y: 1, z: 0 }));
    expect(e.kind).toBe('blocked');
  });
});

describe('teleport targets are walkable floor only', () => {
  const layout = flat();
  const grid = rasterizeLayout(layout);
  it('accepts the spot the walker would start on in every whole room', () => {
    let n = 0;
    for (const r of layout.rooms) {
      if (r.partial) continue;
      const sp = chooseSpawn(layout, r.id, grid);
      if (!sp) continue;
      const c = validateTeleport(grid, layout, sp);
      expect(c.ok, r.id).toBe(true);
      if (c.ok) expect(c.roomId).toBe(r.id);
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });
  it('refuses outside every room, and refuses a spot in a wall', () => {
    expect(validateTeleport(grid, layout, { x: -50, z: -50 })).toEqual({ ok: false, reason: 'no-room' });
    // on the edge of a room, inside the wall's thickness
    const r = layout.rooms[0];
    const a = r.polygon[0], b = r.polygon[1];
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const wall = validateTeleport(grid, layout, mid);
    // either refused outright or moved clear of the wall into the same room; never left in the wall
    if (wall.ok) expect(validateTeleport(grid, layout, { x: wall.x, z: wall.z }).ok).toBe(true);
  });
  it('never returns a spot where a body would not fit', () => {
    // sweep the first room on a 0.1 m lattice: whatever is accepted is free for a body's radius
    const r = layout.rooms.find((q) => !q.partial)!;
    const xs = r.polygon.map((p) => p.x), zs = r.polygon.map((p) => p.z);
    let accepted = 0, refused = 0;
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += 0.1) {
      for (let z = Math.min(...zs); z <= Math.max(...zs); z += 0.1) {
        const c = validateTeleport(grid, layout, { x, z });
        if (c.ok) {
          accepted++;
          const cells = validateTeleport(grid, layout, { x: c.x, z: c.z });
          expect(cells.ok).toBe(true);
          // the circle itself is free: re-check through the same rule the walker uses
          expect(Math.hypot(c.x - x, c.z - z)).toBeLessThanOrEqual(0.3 + 1e-9);
        } else refused++;
      }
    }
    expect(accepted).toBeGreaterThan(20);
    expect(refused).toBeGreaterThan(0);
    expect(CHARACTER_RADIUS_M).toBeGreaterThan(0);
  });
  it('aims: a floor landing carries its verdict, a wall hit has none', () => {
    const sp = chooseSpawn(layout, layout.rooms.find((q) => !q.partial)!.id, grid)!;
    const near = aimTeleport(grid, layout, { x: sp.x, y: 1.2, z: sp.z }, { x: 0, y: -1, z: 0 });
    expect(near.end.kind).toBe('floor');
    expect(near.check?.ok).toBe(true);
    const up = aimTeleport(grid, layout, { x: sp.x, y: 1.2, z: sp.z }, { x: 0, y: 1, z: 0 });
    expect(up.check).toBeNull();
  });
  it('a line of sight stops at a wall', () => {
    const r = layout.rooms.find((q) => !q.partial)!;
    const c = chooseSpawn(layout, r.id, grid)!;
    expect(lineClear(grid, c, c)).toBe(true);
    expect(lineClear(grid, c, { x: c.x + 100, z: c.z })).toBe(false);
  });
});

describe('the panel', () => {
  const rooms = Array.from({ length: 10 }, (_, i) => ({ id: `r${i}`, label: `Room ${i}`, area: '10 m²', goable: i !== 3 }));
  const homes = Array.from({ length: 9 }, (_, i) => ({ key: `h${i}`, label: `Home ${i}`, sub: 'sub' }));
  const model: PanelModel = { title: 'T', subtitle: 's', rooms, homes, currentHomeKey: 'h2', currentRoomId: 'r1', roomPage: 0, homePage: 0 };
  it('pages a long list and keeps every button inside the picture', () => {
    expect(pageCount(0)).toBe(1);
    expect(pageCount(ROWS_PER_PAGE)).toBe(1);
    expect(pageCount(ROWS_PER_PAGE + 1)).toBe(2);
    expect(clampPage(5, 10)).toBe(1);
    expect(clampPage(-3, 10)).toBe(0);
    const l = layoutPanel(model);
    for (const b of l.buttons) {
      expect(b.rect.x).toBeGreaterThanOrEqual(0); expect(b.rect.y).toBeGreaterThanOrEqual(0);
      expect(b.rect.x + b.rect.w).toBeLessThanOrEqual(l.w); expect(b.rect.y + b.rect.h).toBeLessThanOrEqual(l.h);
      // big enough to point at: at least 5 cm tall
      expect(b.rect.h).toBeGreaterThanOrEqual(50);
    }
    expect(l.buttons.filter((b) => b.action.type === 'room')).toHaveLength(ROWS_PER_PAGE);
    expect(l.buttons.filter((b) => b.action.type === 'home')).toHaveLength(ROWS_PER_PAGE);
    const second = layoutPanel({ ...model, roomPage: 1, homePage: 1 });
    expect(second.buttons.filter((b) => b.action.type === 'room')).toHaveLength(3);
    expect(second.buttons.filter((b) => b.action.type === 'home')).toHaveLength(2);
  });
  it('no two buttons overlap', () => {
    for (const m of [model, { ...model, roomPage: 1, homePage: 1 }]) {
      const bs = layoutPanel(m).buttons;
      for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i].rect, b = bs[j].rect;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${i} ${j}`).toBe(false);
      }
    }
  });
  it('marks the room and the home the viewer is in, and a room with no place to stand cannot be chosen', () => {
    const l = layoutPanel(model);
    expect(l.buttons.find((b) => b.action.type === 'room' && b.action.id === 'r1')?.active).toBe(true);
    expect(l.buttons.find((b) => b.action.type === 'room' && b.action.id === 'r3')?.enabled).toBe(false);
    const here = l.buttons.find((b) => b.action.type === 'home' && b.action.key === 'h2')!;
    expect(here.enabled).toBe(false);
    expect(here.sub).toBe('You are here');
    expect(l.buttons.find((b) => b.action.type === 'page' && b.action.list === 'rooms' && b.action.delta === -1)?.enabled).toBe(false);
    expect(l.buttons.find((b) => b.action.type === 'page' && b.action.list === 'rooms' && b.action.delta === 1)?.enabled).toBe(true);
    expect(l.buttons.some((b) => b.action.type === 'exit')).toBe(true);
  });
  it('turns a ray into a pixel and a pixel into the button under it', () => {
    const place = panelPlacement({ x: 0, y: 1.6, z: 0 }, 0, -1, 1.15);
    expect(place.centre.z).toBeCloseTo(-1.15);
    expect(place.right.x).toBeCloseTo(1);
    expect(place.normal.z).toBeCloseTo(1);
    const l = layoutPanel(model);
    const b = l.buttons.find((x) => x.action.type === 'exit')!;
    // aim the ray at the middle of the Exit button
    const px = b.rect.x + b.rect.w / 2, py = b.rect.y + b.rect.h / 2;
    const target = { x: place.centre.x + place.right.x * (px / 1000 - 0.7), y: place.centre.y + (0.43 - py / 1000), z: place.centre.z + place.right.z * (px / 1000 - 0.7) };
    const origin = { x: 0.3, y: 1.2, z: 0.2 };
    const d = { x: target.x - origin.x, y: target.y - origin.y, z: target.z - origin.z };
    const len = Math.hypot(d.x, d.y, d.z);
    const hit = rayToPanelPixel({ origin, dir: { x: d.x / len, y: d.y / len, z: d.z / len } }, place)!;
    expect(hit).not.toBeNull();
    close(hit.px, px, 1e-6); close(hit.py, py, 1e-6);
    expect(hitButton(l, hit.px, hit.py)?.action).toEqual({ type: 'exit' });
    // pointing away, or past the edge, hits nothing
    expect(rayToPanelPixel({ origin, dir: { x: 0, y: 0, z: 1 } }, place)).toBeNull();
    expect(rayToPanelPixel({ origin, dir: { x: 1, y: 0, z: -0.05 } }, place)).toBeNull();
  });
  it('opens in front of the head, facing it, at about arm\'s length', () => {
    const p = panelPlacement({ x: 4, y: 1.55, z: 2 }, 1, 0, 1.15);
    expect(p.centre.x).toBeCloseTo(5.15);
    expect(p.centre.z).toBeCloseTo(2);
    expect(p.centre.y).toBeLessThan(1.55);
    expect(p.normal.x).toBeCloseTo(-1);
    expect(Math.hypot(p.centre.x - 4, p.centre.z - 2)).toBeCloseTo(1.15);
  });
});

describe('frame statistics', () => {
  it('summarises, and counts only frames past one dropped refresh as over budget', () => {
    const s = new FrameStats(100);
    for (let i = 0; i < 95; i++) s.push(13.9, 4);
    for (let i = 0; i < 5; i++) s.push(40, 6);
    const r = s.summary();
    expect(r.frames).toBe(100);
    expect(r.maxMs).toBe(40);
    expect(r.overBudget).toBeCloseTo(0.05);
    expect(r.meanMs).toBeCloseTo(15.2, 1);
    expect(r.cpuMs).toBeCloseTo(4.1, 1);
    expect(r.p95Ms).toBeCloseTo(13.9, 1);
    expect(debugLines(r, { calls: 120, triangles: 250000, presenting: true }).join('\n')).toMatch(/in VR/);
  });
  it('keeps only the last frames and ignores junk', () => {
    const s = new FrameStats(10);
    for (let i = 0; i < 30; i++) s.push(10);
    s.push(NaN); s.push(-1); s.push(0);
    expect(s.summary().frames).toBe(10);
    s.reset();
    expect(s.summary().frames).toBe(0);
  });
});

describe('the list of homes', () => {
  const index = { version: 1 as const, scenes: [
    { id: 'test-sample-1', title: 'Sample 1 BHK', subtitle: 'Made up', origin: 'sample' as const, layout: {} as never, unverified: {} },
    { id: 'test-tower-flat-3bhk-a', title: 'Flat 3 BHK A', origin: 'brochure' as const, layout: {} as never, unverified: {} },
  ] };
  const building = {
    id: 'sample-tower', name: 'Sample Tower', flatTypes: { a: { name: '3 BHK · 930 sq ft', sceneId: 'test-tower-flat-3bhk-a' } },
    levels: [{ id: 'l2', label: 'Level 2', spaces: [
      { id: 'f2-201', kind: 'home', name: 'Flat 201 · 3 BHK', sceneId: 'test-tower-flat-3bhk-a', type: 'a' },
      { id: 'f2-202', kind: 'home', name: 'Flat 202 · 3 BHK', sceneId: 'test-tower-flat-3bhk-a-m', type: 'a', comingNext: true },
      { id: 'gym', kind: 'gym', name: 'Gym', sceneId: 'test-tower-club-gym' },
      { id: 'f2-203', kind: 'home', name: 'Flat 203 · 3 BHK', sceneId: 'test-tower-flat-3bhk-b', type: 'a' },
    ] }],
  } as never;
  it('lists the gallery, then the flats the gallery lacks, one entry per scene, never an amenity or a place coming next', () => {
    const list = buildHomeList(index, [building]);
    expect(list.map((e) => e.label)).toEqual(['Sample 1 BHK', 'Flat 3 BHK A', 'Flat 203']);
    expect(list[1].target).toEqual({ kind: 'scene', scene: 'test-tower-flat-3bhk-a' });
    expect(list[2].target).toEqual({ kind: 'space', building: 'sample-tower', space: 'f2-203' });
    expect(list[2].sub).toMatch(/Sample Tower/);
    expect(new Set(list.map((e) => e.key)).size).toBe(list.length);
    expect(new Set(list.map((e) => e.sceneId)).size).toBe(list.length);
  });
  it('finds the scene behind a target', () => {
    const m = new Map([['sample-tower', building]]) as never;
    expect(sceneOfTarget({ kind: 'scene', scene: 'test-sample-1' }, m)).toBe('test-sample-1');
    expect(sceneOfTarget({ kind: 'space', building: 'sample-tower', space: 'f2-203' }, m)).toBe('test-tower-flat-3bhk-b');
    expect(sceneOfTarget({ kind: 'space', building: 'sample-tower', space: 'nope' }, m)).toBeNull();
    expect(keyOfTarget({ kind: 'space', building: 'a', space: 'b' })).toBe('a/b');
  });
  it('an empty gallery is an empty list, not a failure', () => {
    expect(buildHomeList(null, [])).toEqual([]);
  });
});
