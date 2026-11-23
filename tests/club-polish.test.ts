// SPEC 16.17.4 (23 Nov 2026): the clubhouse polish. The pool table is the generated one again (the 16.17.3 model retired), in a mid walnut
// with its balls inside the box; the banquet and stacking chairs are upholstered in a mid-tone fabric; the gym's frames are a lighter titanium
// grey and every cardio console has a lit display; the wall art is CC0 public-domain paintings fitted inside their mounts, each file the one
// its lock records; the changing rooms' design sheets tile their walls, and the decor label says so.
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { catalogItem, itemFromCatalog } from '../src/core/catalog';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { resetStyle, setStyle } from '../src/look/style';
import { setModelsEnabled } from '../src/look/models/library';
import { PROP_KINDS, clearProps, propNote, setPropFetcher } from '../src/look/gym/props';
import { CLUB_ART, CLUB_DECOR_LABEL, CLUB_DECOR_TILE_LABEL, artSize, clubArtUrl, mountClubDecor, planClubDecor } from '../src/look/club/decor';
import { FRAME, FRAME_GREY, SHROUD } from '../src/look/gen/gymkit';
import { finishDef } from '../src/look/finishes';
import type { Tier } from '../src/look/types';
import type { PropertyFile } from '../src/types';

const ROOT = path.resolve(__dirname, '..');
afterEach(() => { resetStyle(); setModelsEnabled(true); clearProps(); setPropFetcher(null); });

function bounds(g: THREE.Object3D): THREE.Box3 {
  g.updateMatrixWorld(true);
  const bb = new THREE.Box3();
  g.traverse((o) => { if ((o as THREE.Mesh).isMesh) bb.union(new THREE.Box3().setFromObject(o)); });
  return bb;
}
const build = (id: string, tier: Tier, pack = 'clean-contrast'): { g: THREE.Group; item: ReturnType<typeof itemFromCatalog> } => {
  setStyle({ packId: pack });
  const row = catalogItem(id);
  const item = itemFromCatalog(id, { cx: 0, cz: 0, w: row.footprint.w, d: row.footprint.d, yawDeg: 0 }, 'virtual');
  const g = new THREE.Group();
  buildRealFurniture(g, item, tier, createFurnitureKit());
  return { g, item };
};
const meshes = (g: THREE.Object3D): THREE.Mesh[] => { const out: THREE.Mesh[] = []; g.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const matOf = (m: THREE.Mesh): THREE.MeshStandardMaterial => m.material as THREE.MeshStandardMaterial;
/** relative luminance of an sRGB colour, 0..1 */
const lum = (hex: string): number => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

describe('the pool table: generated, a mid walnut, its balls racked inside the box', () => {
  it('no downloaded model is asked for or shipped any more (the 16.17.3 model was retired), and the card credits none', () => {
    expect((PROP_KINDS as string[]).includes('pool-table')).toBe(false);
    expect(fs.existsSync(path.join(ROOT, 'public/look/club/models/pool-table.glb'))).toBe(false);
    const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/look/club/club.lock.json'), 'utf8')) as { assets: Record<string, unknown>; rejected: { what: string; why: string }[] };
    expect(lock.assets['sketchfab-cc96165eda374800a45f510d98216490']).toBeUndefined();
    expect(lock.rejected.some((r) => r.what.startsWith('Pooltable (jdastine), CC BY') && /retired/.test(r.why))).toBe(true);
    for (const tier of ['low', 'medium', 'high'] as Tier[]) {
      const { g, item } = build('hall-pool-table', tier);
      expect(g.userData.gymPropsWanted ?? [], tier).not.toContain('pool-table');
      expect(propNote(item.id)).not.toContain('Pooltable');
    }
  });
  it('the walnut is a mid tone (not a black mass), the cloth a felt, and every ball stands below the rails\' top, inside the box', () => {
    for (const tier of ['medium', 'high'] as Tier[]) {
      const { g, item } = build('hall-pool-table', tier);
      const ms = meshes(g);
      const body = ms.filter((m) => m.name === 'pool-body');
      expect(body.length).toBeGreaterThan(0);
      expect(matOf(body[0]).name).toBe('wood');
      expect(lum(`#${matOf(body[0]).color.getHexString()}`)).toBeGreaterThan(0.12);
      expect(matOf(ms.find((m) => m.name === 'pool-cloth')!).name).toBe('felt');
      const balls = ms.filter((m) => m.name === 'pool-balls');
      expect(balls.length, tier).toBeGreaterThan(0);
      const top = Math.max(...balls.map((m) => new THREE.Box3().setFromObject(m).max.y));
      expect(top, tier).toBeLessThanOrEqual(item.heightM);
      const bb = bounds(g);
      expect(bb.max.x - bb.min.x).toBeLessThanOrEqual(item.box.w + 0.012);
      expect(bb.max.z - bb.min.z).toBeLessThanOrEqual(item.box.d + 0.012);
      expect(bb.max.y).toBeLessThanOrEqual(item.heightM + 0.012);
    }
  });
});

describe('the chairs read under a hall\'s light', () => {
  it('banquet, card and chess chairs, the stacking chair and the carrom stools are a mid-tone woven fabric', () => {
    for (const id of ['hall-banquet-set-4', 'games-card-set', 'games-chess-set', 'hall-chair', 'games-carrom-set']) {
      setModelsEnabled(false);
      const { g } = build(id, 'medium');
      const seats = meshes(g).filter((m) => /^(chair-seat|chair-back|stool-seat)$/.test(m.name));
      expect(seats.length, id).toBeGreaterThan(0);
      for (const s of seats) {
        expect(matOf(s).name, id).toBe('weave');
        expect(lum(`#${matOf(s).color.getHexString()}`), `${id} ${s.name}`).toBeGreaterThan(0.2);
      }
    }
  });
});

describe('the gym\'s generated machines', () => {
  it('frames, silver parts and covers are light enough to show their shape in a windowless gym, and stay in that order', () => {
    expect(lum(FRAME.tint!)).toBeGreaterThan(0.25);
    expect(lum(FRAME_GREY.tint!)).toBeGreaterThan(lum(FRAME.tint!));
    expect(lum(SHROUD.tint!)).toBeGreaterThan(0.18);
  });
  it('every generated cardio machine has a console with a lit display (a dim glow, not a lamp) and keys, inside its box', () => {
    for (const id of ['gym-treadmill', 'gym-cross', 'gym-upright-bike', 'gym-spin-bike', 'gym-recumbent', 'gym-rower', 'gym-stair']) {
      setModelsEnabled(false);
      const { g, item } = build(id, 'medium');
      const ms = meshes(g);
      const lit = ms.filter((m) => /-screen-lit$/.test(m.name));
      expect(lit.length, id).toBeGreaterThan(0);
      for (const m of lit) {
        const e = matOf(m).emissive;
        expect(Math.max(e.r, e.g, e.b), id).toBeGreaterThan(0.05);
        expect(Math.max(e.r, e.g, e.b) * matOf(m).emissiveIntensity, id).toBeLessThan(0.6);
      }
      expect(ms.some((m) => /-buttons$/.test(m.name)), id).toBe(true);
      const bb = bounds(g);
      expect(bb.max.y, id).toBeLessThanOrEqual(item.heightM + 0.012);
      expect(bb.max.x - bb.min.x, id).toBeLessThanOrEqual(item.box.w + 0.012);
      expect(bb.max.z - bb.min.z, id).toBeLessThanOrEqual(item.box.d + 0.012);
    }
  });
  it('the treadmill\'s grips carry steel pulse sensors on medium and high', () => {
    setModelsEnabled(false);
    expect(meshes(build('gym-treadmill', 'high').g).some((m) => m.name === 'tread-pulse-grips')).toBe(true);
    expect(meshes(build('gym-treadmill', 'low').g).some((m) => m.name === 'tread-pulse-grips')).toBe(false);
  });
});

describe('wall art: CC0 public-domain paintings, fitted in their mounts', () => {
  const ART = path.join(ROOT, 'public/look/club/art');
  const lock = JSON.parse(fs.readFileSync(path.join(ART, 'art.lock.json'), 'utf8')) as {
    assets: Record<string, { name: string; authors: string[]; page: string; mirror: string; licence: string; licenceUrl: string; licenceWords: string; use: string; files: { url: string; sha256?: string; sha1?: string }[] }>;
    outputs: Record<string, { bytes: number; sha256: string }>;
  };
  it('every picture has its two files, each the one the lock records, small enough for a wall', () => {
    for (const a of CLUB_ART) for (const t of ['high', 'low'] as Tier[]) {
      const rel = clubArtUrl(a.id, t).replace('/look/club/art/', '');
      const o = lock.outputs[rel];
      expect(o, rel).toBeTruthy();
      const buf = fs.readFileSync(path.join(ART, rel));
      expect(buf.length, rel).toBe(o.bytes);
      expect(crypto.createHash('sha256').update(buf).digest('hex'), rel).toBe(o.sha256);
      expect(buf.length, rel).toBeLessThan(t === 'low' ? 40_000 : 200_000);
    }
    expect(Object.keys(lock.outputs)).toHaveLength(CLUB_ART.length * 2);
  });
  it('CC0 only, from The Met\'s Open Access, with the artist, both pages and the source checksums', () => {
    expect(Object.keys(lock.assets)).toHaveLength(CLUB_ART.length);
    for (const [id, a] of Object.entries(lock.assets)) {
      expect(a.licence, id).toBe('CC0 1.0');
      expect(a.licenceUrl).toContain('publicdomain/zero/1.0');
      expect(a.licenceWords).toMatch(/isPublicDomain": true/);
      expect(a.page, id).toMatch(/^https:\/\/www\.metmuseum\.org\/art\/collection\/search\/\d+$/);
      expect(a.mirror, id).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:.* MET .*|^https:\/\/commons\.wikimedia\.org\/wiki\/File:.*_MET_.*/);
      expect(a.authors.length, id).toBeGreaterThan(0);
      expect(a.files.some((f) => /^[0-9a-f]{64}$/.test(f.sha256 ?? '')), id).toBe(true);
      expect(a.files.some((f) => /^[0-9a-f]{40}$/.test(f.sha1 ?? '')), id).toBe(true);
      for (const f of a.files) expect(f.url, id).toMatch(/^https:\/\/upload\.wikimedia\.org\//);
    }
    const licence = fs.readFileSync(path.join(ART, 'LICENCE.txt'), 'utf8');
    for (const a of Object.values(lock.assets)) { expect(licence).toContain(a.page); expect(licence).toContain(a.authors[0]); }
  });
  it('a frame gets a picture of its own orientation, the plan is the same every time, and the picture sits inside the mount at its aspect', () => {
    for (const id of ['test-tower-club-games', 'test-tower-club-hall-1', 'test-tower-club-hall-2', 'test-tower-club-lounge', 'test-tower-club-foyer', 'test-hall-sample']) {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'property.json'), 'utf8')) as PropertyFile;
      const plan = planClubDecor(p.layout, p.furniture, p.spaceKind!);
      expect(planClubDecor(p.layout, p.furniture, p.spaceKind!)).toEqual(plan);
      for (const d of plan.filter((x) => x.kind === 'art')) {
        const a = CLUB_ART.find((x) => x.id === d.art);
        expect(a, `${id} ${d.art}`).toBeTruthy();
        expect(a!.aspect >= 1, `${id} ${d.art}`).toBe(d.w >= d.h);
        const [pw, ph] = artSize(d);
        expect(pw / ph).toBeCloseTo(a!.aspect, 3);
        expect(pw).toBeLessThan(d.w * 0.85);
        expect(ph).toBeLessThan(d.h * 0.85);
      }
    }
  });
  it('under node (no image decoder) the frames keep their colour fields, and dispose leaves nothing', () => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes/test-tower-club-games/property.json'), 'utf8')) as PropertyFile;
    const parent = new THREE.Group();
    const h = mountClubDecor({ parent, layout: p.layout, furniture: p.furniture, kind: 'games', tier: 'medium' });
    expect(meshes(h.group).filter((m) => m.name === 'art-print').length).toBe(h.pieces.filter((x) => x.kind === 'art').length);
    h.dispose();
    expect(parent.children).toHaveLength(0);
  });
});

describe('changing rooms: a sample tiled finish, labelled', () => {
  it('both design sheets (authored and shipped) tile the walls to the ceiling and lay a grey floor tile', () => {
    for (const n of [1, 2]) {
      const id = `test-tower-club-changing-${n}`;
      const authored = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/building/space-designs', `${id}.json`), 'utf8')) as { rooms: Record<string, { wall: string; floor: string }>; note: string };
      const shipped = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, 'design.json'), 'utf8')) as unknown;
      expect(shipped).toEqual(authored);
      const room = authored.rooms[`changing-${n}`];
      expect(finishDef(room.wall)?.kind).toBe('tile');
      expect(finishDef(room.floor)?.kind).toBe('tile');
      expect(authored.note).toMatch(/sample finish, not from the plan/);
    }
  });
  it('the decor label names the wall tiles where the sheet gives them', () => {
    const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes/test-tower-club-changing-2/property.json'), 'utf8')) as PropertyFile;
    const parent = new THREE.Group();
    setModelsEnabled(false);
    const tiled = mountClubDecor({ parent, layout: p.layout, furniture: p.furniture, kind: 'gym', tier: 'medium', wallTiles: true });
    expect(tiled.label).toBe(CLUB_DECOR_TILE_LABEL);
    expect(CLUB_DECOR_TILE_LABEL).toMatch(/wall tiles are sample decor, not from the plan/);
    tiled.dispose();
    const plain = mountClubDecor({ parent, layout: p.layout, furniture: p.furniture, kind: 'gym', tier: 'medium' });
    expect(plain.label).toBe(CLUB_DECOR_LABEL);
    plain.dispose();
  });
});
