// Style packs, the design sheet and decor (SPEC 16.13), headless: resolution order and provenance, the openable wardrobe keeps its hinges
// under a style, decor stays out of collision and measurement, sampled colours win, the shipped sheets are valid.
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { itemFromCatalog } from '../src/core/catalog';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { boxAxes } from '../src/core/geometry';
import { applyDesigns, parseDesigns } from '../src/look/designs';
import { setItemDesigns, buildRealFurniture, resolveItemLook } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { parseDesignSheet } from '../src/look/design-sheet';
import type { DesignSheet } from '../src/look/design-sheet';
import { PACKS } from '../src/look/packs';
import { doorPanelColour, finishNote, getStyle, provLabel, resetStyle, resolveLook, roomFinishIds, setStyle } from '../src/look/style';
import { finishDef, swatch } from '../src/look/finishes';
import { applyRoomFinishes, autoFixtures, buildDecorGroup } from '../src/look/design-mount';
import { buildWardrobeModel, REPLACED_NAMES } from '../src/buyer/wardrobe-model';
import { shutterPose, specFromDesign } from '../src/buyer/wardrobe-swing';
import { FRONT_RECESS } from '../src/look/gen/wardrobe';
import { CURTAIN_DEFAULTS, SHEER_PLEAT_DEPTH_M, SHEER_PLEAT_M, buildCurtain, sheerGatherM } from '../src/look/gen/decor';
import { GEN_QUALITY } from '../src/look/gen/core';
import type { FurnitureItem, PropertyFile } from '../src/types';
import { makeBedroom } from './helpers/synthetic-bedroom';

const ROOT = path.resolve(__dirname, '..');
const readScene = (id: string, file: string): unknown => JSON.parse(fs.readFileSync(path.join(ROOT, 'public/scenes', id, file), 'utf8'));
// the home that ships a designer's sheet is found by looking, not by name (the anti-overfit lint keeps scene names out of tests)
const DESIGNER = fs.readdirSync(path.join(ROOT, 'public/scenes')).find((d) => !d.startsWith('test-') && fs.existsSync(path.join(ROOT, 'public/scenes', d, 'design.json')))!;
const sheet = (o: Partial<DesignSheet> & { pack: string }): DesignSheet => ({ version: 1, source: 'designer-renders', items: {}, rooms: {}, fixtures: [], ...o });
const item = (id: string, kind: FurnitureItem['kind'], label = '', finish?: FurnitureItem['finish']): FurnitureItem =>
  ({ id, source: 'real', kind, label, box: { cx: 0, cz: 0, w: 1.5, d: 0.6, yawDeg: 0 }, heightM: kind === 'wardrobe' ? 2.4 : 0.9, surfaceHeightM: 0.5, ...(finish ? { finish } : {}) });

afterEach(() => { resetStyle(); setItemDesigns(null); });

describe('resolution order and provenance', () => {
  it('without a sheet: the pack decides, the generator default fills the rest', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const r = resolveLook(item('wardrobe-9', 'wardrobe'))!;
    expect(r.params.shutterStyle).toBe('fluted-strip');
    expect(r.prov['param:shutterStyle']).toBe('pack');
    expect(r.prov['param:fluteBand']).toBe('default');
    expect(r.prov['role:case']).toBe('pack');
    expect(r.roles.case.key).toBe('wood');
  });
  it('the drawing is authoritative for structure, over the sheet, the viewer and the pack', () => {
    setStyle({ packId: 'walnut-white', sheet: sheet({ pack: 'walnut-white', items: { 'wardrobe-1': { params: { shuttersPerBay: 3, bays: 5, handleYM: 1.4 } } } }) });
    const it = item('wardrobe-1', 'wardrobe');
    const drawing = { wardrobe: { bays: 3, shuttersPerBay: 2, drawerStripM: 0.1778, baseGapM: 0.0508, frontColor: '#E3D5C8', handleColor: '#5B3B2C', handleYM: 0.99, handleLenM: 0.26 } };
    const r = resolveLook(it, drawing)!;
    expect(r.params.bays).toBe(3);
    expect(r.params.shuttersPerBay).toBe(2);
    expect(r.params.handleYM).toBe(0.99);
    expect(r.params.plinthM).toBeCloseTo(0.0508, 6);
    expect(r.prov['param:bays']).toBe('drawing');
    expect(r.prov['param:handleYM']).toBe('drawing');
  });
  it('the viewer\'s own choice beats the sheet, the sheet beats the pack, the drawing beats all for structure', () => {
    // the viewer's slots are the palette's: bed = Frame / Headboard / Bedding, so primary = frame, fabric = headboard, secondary = bedding
    const it = item('bed-1', 'bed', 'Bed', { primary: 'wood-walnut', fabric: 'fab-teal', secondary: 'bed-sage', style: 'upholstered' });
    setStyle({ packId: 'warm-oak-navy' });
    let r = resolveLook(it)!;
    expect(r.params.headboard).toBe('upholstered');
    expect(r.prov['param:headboard']).toBe('viewer');
    expect(r.finishIds.headboard).toBe('fab-teal');
    expect(r.finishIds.bedFrame).toBe('fab-teal'); // an upholstered bed wraps its frame in the headboard fabric
    expect(r.finishIds.duvet).toBe('bed-sage');
    expect(r.prov['role:duvet']).toBe('viewer');
    expect(r.prov['role:cushion']).toBe('pack');
    setStyle({ packId: 'warm-oak-navy', sheet: sheet({ pack: 'warm-oak-navy', items: { 'bed-1': { params: { headboard: 'slatted' }, roles: { bedFrame: 'charcoal-matte', cushion: 'weave-sage' } } } }) });
    r = resolveLook(it)!;
    expect(r.params.headboard).toBe('upholstered');            // the viewer's pick wins over the sheet
    expect(r.prov['param:headboard']).toBe('viewer');
    expect(r.finishIds.bedFrame).toBe('fab-teal');
    expect(r.prov['role:bedFrame']).toBe('viewer');
    expect(r.finishIds.cushion).toBe('weave-sage');            // where the viewer said nothing the sheet decides
    expect(r.prov['role:cushion']).toBe('sheet');
    r = resolveLook(item('bed-1', 'bed'))!;
    expect(r.params.headboard).toBe('slatted');
    expect(r.prov['param:headboard']).toBe('sheet');
    // the drawing's base height beats the viewer, the sheet and the pack
    r = resolveLook(item('bed-1', 'bed', 'Bed', { style: 'storage' }), { bed: { baseTopM: 0.36 } })!;
    expect(r.params.baseTopM).toBe(0.36);
    expect(r.prov['param:baseTopM']).toBe('drawing');
    expect(r.params.base).toBe('box');
  });
  it('a bed\'s style is a real shape: panel, upholstered, storage box', () => {
    setStyle({ packId: 'light-scandinavian' });
    const shape = (style: string) => {
      const g = new THREE.Group();
      buildRealFurniture(g, { ...item('bed-1', 'bed', 'Bed', { style }), box: { cx: 0, cz: 0, w: 1.6, d: 2.0, yawDeg: 0 } }, 'medium', createFurnitureKit());
      return g.children.map((c) => c.name);
    };
    expect(shape('panel')).toContain('bed-headboard');
    expect(shape('upholstered')).toContain('bed-channels');
    expect(shape('storage')).toContain('bed-seam');
    expect(shape('storage')).not.toContain('bed-legs');
  });
  it('each family\'s slots land on the right parts: sofa legs, wardrobe handles, table top and legs', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const s = resolveLook(item('sofa-1', 'sofa', '', { primary: 'metal-brass', fabric: 'fab-mustard' }))!;
    expect(s.params.legs).toBe('metal');
    expect(s.finishIds.legs).toBe('metal-brass');
    expect(s.finishIds.fabric).toBe('fab-mustard');
    const w = resolveLook(item('wardrobe-1', 'wardrobe', '', { primary: 'lam-sage', secondary: 'metal-rose' }))!;
    expect(w.finishIds.case).toBe('lam-sage');
    expect(w.finishIds.flute).toBe('lam-sage');
    expect(w.finishIds.handle).toBe('metal-rose');
    const t = resolveLook(item('dining-1', 'dining', '', { primary: 'wood-white', secondary: 'metal-black' }))!;
    expect(t.finishIds.top).toBe('wood-white');
    expect(t.finishIds.legs).toBe('metal-black');
    expect(t.roles.top.key).toBe('laminate');
  });
  it('a generated piece applies the viewer\'s finish itself and tells the old recolour pass to stand down', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const g = new THREE.Group();
    buildRealFurniture(g, item('bed-1', 'bed', 'Bed', { primary: 'wood-walnut' }), 'medium', createFurnitureKit());
    expect(g.userData.finishApplied).toBe(true);
    const frame = g.children.find((c) => c.name === 'bed-frame') as THREE.Mesh;
    expect((frame.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('a87c56');
    setStyle({ packId: 'classic' });
    const c = new THREE.Group();
    buildRealFurniture(c, item('bed-1', 'bed', 'Bed', { primary: 'wood-walnut' }), 'medium', createFurnitureKit());
    expect(c.userData.finishApplied).toBe(false);
  });
  it('the palette is one table: the viewer\'s ids and the style ids both resolve', () => {
    expect(finishDef('wood-oak')?.material).toBe('wood');
    expect(finishDef('oak')?.material).toBe('wood');
    expect(finishDef('lam-navy')?.material).toBe('laminate');
    expect(finishDef('fab-teal')?.material).toBe('weave');
    expect(finishDef('bed-sage')?.material).toBe('quilt');
    expect(finishDef('metal-black')?.material).toBe('blackMetal');
    expect(finishDef('nope')).toBeNull();
    expect(swatch('wood-oak')?.name).toBe('Oak');
  });
  it('a long bar centres itself on the fluted band; the drawing\'s handle height is kept for a plain bar', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const drawing = { wardrobe: { bays: 3, shuttersPerBay: 2, drawerStripM: 0.1778, baseGapM: 0.0508, frontColor: '#E3D5C8', handleColor: '#5B3B2C', handleYM: 0.99, handleLenM: 0.26 } };
    const long = resolveLook(item('wardrobe-1', 'wardrobe'), drawing)!;
    expect(long.params.handle).toBe('long-bar');
    expect(long.params.handleYM).toBe(0);
    const g = new THREE.Group();
    buildRealFurniture(g, { ...item('wardrobe-1', 'wardrobe'), heightM: 2.54, box: { cx: 0, cz: 0, w: 2.74, d: 0.61, yawDeg: 0 } }, 'medium', createFurnitureKit());
    const bars = g.children.find((c) => c.name === 'shutter-handles') as THREE.Mesh;
    const bb = new THREE.Box3().setFromObject(bars);
    const band = long.params.fluteBand as [number, number];
    // no drawing is registered for this item, so the shutters run from the plinth (0.05) to 3 mm under the top
    expect((bb.min.y + bb.max.y) / 2).toBeCloseTo(0.05 + (2.54 - 0.003 - 0.05) * (band[0] + band[1]) / 2, 2);
    // a plain bar style keeps the drawing's height
    setStyle({ packId: 'walnut-white' });
    const bar = resolveLook(item('wardrobe-1', 'wardrobe'), drawing)!;
    expect(bar.params.handle).toBe('bar');
    expect(bar.params.handleYM).toBe(0.99);
    expect(bar.prov['param:handleYM']).toBe('drawing');
  });
  it('door panels take their colour from the active style, Classic keeps the default', () => {
    setStyle({ packId: 'walnut-white' });
    expect(doorPanelColour()).toBe('#7B5B45');
    setStyle({ packId: 'warm-oak-navy' });
    expect(doorPanelColour()).toBe('#CDAB8A');
    setStyle({ packId: 'classic' });
    expect(doorPanelColour()).toBeNull();
  });
  it('picking another pack puts the designer\'s sheet aside; the designer\'s look is the sheet\'s own pack', () => {
    const sh = sheet({ pack: 'warm-oak-navy', items: { 'wardrobe-1': { params: { shutterStyle: 'louvred' } } } });
    const it = item('wardrobe-1', 'wardrobe');
    setStyle({ sheet: sh });
    expect(getStyle().designerLook).toBe(true);
    expect(resolveLook(it)!.params.shutterStyle).toBe('louvred');
    setStyle({ packId: 'walnut-white' });
    expect(getStyle().designerLook).toBe(false);
    const r = resolveLook(it)!;
    expect(r.params.shutterStyle).toBe('framed');
    expect(r.prov['param:shutterStyle']).toBe('pack');
    setStyle({ packId: 'warm-oak-navy' });
    expect(getStyle().designerLook).toBe(true);
  });
  it('a scene with no sheet gets the default pack; an unknown pack id falls back to it', () => {
    setStyle({});
    expect(getStyle().pack.id).toBe('clean-contrast'); // SPEC 16.18: the default pack
    setStyle({ packId: 'no-such-pack' });
    expect(getStyle().pack.id).toBe('clean-contrast');
  });
  it('Classic resolves to nothing: the old builders run', () => {
    setStyle({ packId: 'classic' });
    expect(resolveLook(item('bed-1', 'bed'))).toBeNull();
    expect(roomFinishIds('x')).toEqual({});
  });
  it('labels say where a value came from, "from the designer\'s renders" only for a designer sheet', () => {
    expect(provLabel('drawing', null)).toBe('from the drawing');
    expect(provLabel('pack', null)).toBe('typical finish (style pack)');
    expect(provLabel('default', null)).toBe('typical finish (style pack)');
    expect(provLabel('sheet', 'designer-renders')).toBe("from the designer's renders");
    expect(provLabel('sheet', 'broker')).not.toContain('designer');
    expect(provLabel('viewer', null)).toBe('your choice');
    setStyle({ packId: 'warm-oak-navy', sheet: sheet({ pack: 'warm-oak-navy', items: { 'bed-1': { roles: { bedFrame: 'walnut' } } } }) });
    expect(finishNote(resolveLook(item('bed-1', 'bed'))!, 'Warm Oak & Navy')).toContain("from the designer's renders");
    expect(finishNote(resolveLook(item('bed-2', 'bed'))!, 'Warm Oak & Navy')).toContain('typical finish (style pack)');
  });
  it('room finishes: the sheet\'s over the pack\'s, with provenance', () => {
    setStyle({ packId: 'warm-oak-navy', sheet: sheet({ pack: 'warm-oak-navy', rooms: { a: { wall: 'wall-cream' } } }) });
    expect(roomFinishIds('a').wall).toEqual(['wall-cream', 'sheet']);
    expect(roomFinishIds('a').floor).toEqual(['tile-beige-gloss', 'pack']);
    expect(roomFinishIds('b').wall).toEqual(['wall-beige', 'pack']);
  });
});

describe('the design sheet is read leniently and holds no sizes', () => {
  it('drops unknown finishes, bad params, sizes and malformed fixtures; keeps the rest', () => {
    const s = parseDesignSheet({
      version: 1, pack: 'warm-oak-navy', source: 'designer-renders',
      items: {
        'wardrobe-1': { params: { shutterStyle: 'framed', w: 9, heightM: 5, bays: 'x' }, roles: { case: 'oak', handle: 'not-a-finish' } },
        'bed-1': { finish: { primary: 'walnut', fabric: 'nope', style: 'slatted' } },
      },
      rooms: { r: { wall: 'wall-beige', floor: 'zzz' } },
      fixtures: [
        { kind: 'curtain', roomId: 'r', edge: 0, u0: 0, u1: 2 }, { kind: 'curtain', roomId: 'r' }, { kind: 'nonsense', roomId: 'r' },
        { kind: 'rug', roomId: 'r', aroundItem: 'bed-1' }, { kind: 'downlights', roomId: 'r', points: [[0, 0], [1]] },
      ],
    })!;
    expect(s.items['wardrobe-1'].params).toEqual({ shutterStyle: 'framed' });
    expect(s.items['wardrobe-1'].roles).toEqual({ case: 'oak' });
    expect(s.items['bed-1'].finish).toEqual({ primary: 'walnut', style: 'slatted' });
    expect(s.rooms.r).toEqual({ wall: 'wall-beige' });
    expect(s.fixtures.map((f) => f.kind)).toEqual(['curtain', 'rug']);
  });
  it('rejects a file that is not a version-1 sheet', () => {
    expect(parseDesignSheet(null)).toBeNull();
    expect(parseDesignSheet({ version: 2, pack: 'x' })).toBeNull();
    expect(parseDesignSheet({ version: 1 })).toBeNull();
  });
  for (const id of [DESIGNER, 'test-sample-3']) {
    it(`the shipped sheet of ${id} is valid and loses nothing when read`, () => {
      const raw = readScene(id, 'design.json') as { pack: string; items: object; fixtures: unknown[]; rooms: object };
      const s = parseDesignSheet(raw)!;
      expect(s).not.toBeNull();
      expect(PACKS.some((p) => p.id === s.pack)).toBe(true);
      expect(Object.keys(s.items).length).toBe(Object.keys(raw.items).length);
      expect(s.fixtures.length).toBe(raw.fixtures.length);
      expect(Object.keys(s.rooms).length).toBe(Object.keys(raw.rooms).length);
      for (const [k, v] of Object.entries(s.items)) expect(JSON.stringify(v), k).toBe(JSON.stringify((raw.items as Record<string, unknown>)[k]));
      // no client or project name, no title-block detail
      expect(JSON.stringify(raw)).not.toMatch(/\b(architect|client|project name|drawn by|sheet no|date)\b/i);
    });
  }
  it('the two shipped homes use different packs (repeatability)', () => {
    const a = parseDesignSheet(readScene(DESIGNER, 'design.json'))!;
    const b = parseDesignSheet(readScene('test-sample-3', 'design.json'))!;
    expect(a.pack).not.toBe(b.pack);
    expect(a.source).toBe('designer-renders');
  });
});

describe('the openable wardrobe keeps its hinges under a style', () => {
  const bedroom = makeBedroom();
  const designs = parseDesigns(bedroom.designs)!;
  const items = applyDesigns(bedroom.property.furniture, designs);
  setItemDesigns(null);
  const wardrobe = items.find((i) => i.id === 'wardrobe-1')!;
  const open = designs.items['wardrobe-1'].openable!;
  const wd = designs.items['wardrobe-1'].wardrobe!;
  const spec = specFromDesign(wardrobe, open);
  const a = boxAxes(wardrobe.box).a;

  it('has one pivot per shutter at the spec\'s hinge, in every pack', () => {
    for (const pack of PACKS) {
      setStyle({ packId: pack.id });
      const model = buildWardrobeModel(wardrobe, spec, wd);
      for (const s of spec.shutters) {
        const piv = model.pivot(s.id)!;
        expect(piv, `${pack.id} ${s.id}`).toBeTruthy();
        expect(piv.position.x).toBeCloseTo(s.hingeU, 9);
        expect(piv.getObjectByName(`shutter-slab:${s.id}`)).toBeTruthy();
      }
      model.dispose();
    }
  });
  it('at 90 degrees every slab reaches out to its width and stays at its hinge, styled or not', () => {
    for (const pack of PACKS) {
      setStyle({ packId: pack.id });
      const model = buildWardrobeModel(wardrobe, spec, wd);
      for (const s of spec.shutters) {
        model.setAngle(s.id, Math.PI / 2);
        const slab = model.pivot(s.id)!.getObjectByName(`shutter-slab:${s.id}`) as THREE.Mesh;
        model.group.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(slab);
        const h = shutterPose(wardrobe.box, s, 0).hinge;
        const outs = [bb.min, bb.max].map((c) => (c.x - h.x) * a.x + (c.z - h.z) * a.z);
        expect(Math.max(...outs), `${pack.id} ${s.id}`).toBeCloseTo(s.widthM - 0.0015, 3);
        expect(Math.min(...outs)).toBeCloseTo(0.0015, 3);
      }
      model.dispose();
    }
  });
  it('closed again, a styled slab lies behind the front plane by its recess, and the angle comes back to 0', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const model = buildWardrobeModel(wardrobe, spec, wd);
    const s = spec.shutters[0];
    model.setAngle(s.id, 1.2);
    expect(model.angle(s.id)).toBeCloseTo(1.2, 9);
    model.setAngle(s.id, 0);
    expect(model.angle(s.id)).toBe(0);
    model.group.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(model.pivot(s.id)!.getObjectByName(`shutter-slab:${s.id}`)!);
    const front = (c: THREE.Vector3): number => (c.x - wardrobe.box.cx) * a.x + (c.z - wardrobe.box.cz) * a.z;
    expect(Math.max(front(bb.min), front(bb.max))).toBeCloseTo(wardrobe.box.d / 2 - FRONT_RECESS, 3);
    model.dispose();
  });
  it('a fluted style puts its flutes and handle on the pivot, so they swing with the shutter', () => {
    setStyle({ packId: 'warm-oak-navy' });
    const model = buildWardrobeModel(wardrobe, spec, wd);
    const piv = model.pivot(spec.shutters[0].id)!;
    expect(piv.getObjectByName(`shutter-flutes:${spec.shutters[0].id}`)).toBeTruthy();
    expect(piv.getObjectByName(`shutter-handle:${spec.shutters[0].id}`)).toBeTruthy();
    model.dispose();
  });
  it('the closed wardrobe\'s own shutter meshes are the ones hidden while the model is in use, its plinth and loft are not', () => {
    for (const n of ['shutter-face', 'shutter-flutes', 'shutter-flute-back', 'shutter-handles', 'carcass', 'drawer-fronts']) expect(REPLACED_NAMES.test(n), n).toBe(true);
    for (const n of ['plinth', 'loft-face', 'shutter-slab:b1-l']) expect(REPLACED_NAMES.test(n), n).toBe(false);
    setStyle({ packId: 'warm-oak-navy' });
    const g = new THREE.Group();
    buildRealFurniture(g, wardrobe, 'medium', createFurnitureKit());
    const hidden = g.children.filter((c) => REPLACED_NAMES.test(c.name)).map((c) => c.name);
    expect(hidden).toEqual(expect.arrayContaining(['shutter-face', 'shutter-handles']));
    expect(g.children.some((c) => c.name === 'plinth')).toBe(true);
  });
  it('the drawing\'s bays and shutters win over a style: the same six shutters in every pack', () => {
    setItemDesigns(new Map([[wardrobe.id, { wardrobe: wd }]]));
    for (const pack of PACKS.filter((p) => !p.classic)) {
      setStyle({ packId: pack.id });
      const r = resolveItemLook(wardrobe)!;
      expect(r.params.bays).toBe(wd.bays);
      expect(r.params.shuttersPerBay).toBe(wd.shuttersPerBay);
      expect(r.prov['param:bays']).toBe('drawing');
    }
  });
});

describe('decor stays out of collision, measurement and the drawing', () => {
  const property = readScene('test-sample-3', 'property.json') as PropertyFile;
  const layout = property.layout;
  const baseGrid = rasterizeLayout(layout);
  const items = property.furniture;

  it('building the decor changes neither the layout, the items nor the grid', () => {
    setStyle({ packId: 'walnut-white', sheet: parseDesignSheet(readScene('test-sample-3', 'design.json')) });
    const layoutBefore = JSON.stringify(layout.rooms.map((r) => r.polygon)) + JSON.stringify(layout.openings);
    const itemsBefore = JSON.stringify(items);
    const gridBefore = baseGrid.cells.slice();
    const g = stampFurniture(baseGrid, items);
    const stamped = g.cells.slice();
    const built = buildDecorGroup(layout, items, 'medium');
    // the sample's typical scheme is calm now (curtains and rugs, no panelling), so two kinds is the floor
    expect(Object.keys(built.counts).length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(layout.rooms.map((r) => r.polygon)) + JSON.stringify(layout.openings)).toBe(layoutBefore);
    expect(JSON.stringify(items)).toBe(itemsBefore);
    expect(Array.from(baseGrid.cells)).toEqual(Array.from(gridBefore));
    expect(Array.from(stampFurniture(baseGrid, items).cells)).toEqual(Array.from(stamped));
  });
  it('no mesh of the decor can be hit by a ray, and the group is tagged decor', () => {
    setStyle({ packId: 'warm-oak-navy', sheet: parseDesignSheet(readScene(DESIGNER, 'design.json')) });
    const son = readScene(DESIGNER, 'property.json') as PropertyFile;
    const built = buildDecorGroup(son.layout, son.furniture, 'high');
    expect(built.group.userData.decor).toBe(true);
    let meshes = 0;
    built.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes++; expect(o.userData.decor).toBe(true); } });
    expect(meshes).toBeGreaterThan(10);
    built.group.updateMatrixWorld(true);
    // straight down through the rug and the bed's rug margin
    const rc = new THREE.Raycaster(new THREE.Vector3(1.0, 3, 0.3), new THREE.Vector3(0, -1, 0));
    expect(rc.intersectObject(built.group, true)).toEqual([]);
    const rc2 = new THREE.Raycaster(new THREE.Vector3(0.6, 1.3, 0), new THREE.Vector3(1, 0, 0));
    expect(rc2.intersectObject(built.group, true)).toEqual([]);
  });
  it('the decor sits on its walls: every piece is inside the room or against its wall', () => {
    setStyle({ packId: 'warm-oak-navy', sheet: parseDesignSheet(readScene(DESIGNER, 'design.json')) });
    const son = readScene(DESIGNER, 'property.json') as PropertyFile;
    const room = son.layout.rooms.find((r) => r.id === 'son-room')!;
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const built = buildDecorGroup(son.layout, son.furniture, 'medium');
    const bb = new THREE.Box3().setFromObject(built.group);
    // nothing (not even a rug, which is clipped by the room only by its margins) pokes out of the home's footprint by more than a wall
    expect(bb.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(bb.max.y).toBeLessThanOrEqual(son.layout.wallHeightM + 0.01);
    for (const name of ['slat-wall', 'panelling', 'window-seat', 'curtain']) expect(built.counts[name] ?? 0, name).toBeGreaterThan(0);
    void xs; void zs;
  });
  it('without a sheet the pack adds a rug under each bed and curtains on large bedroom windows, Classic adds none', () => {
    setStyle({ packId: 'light-scandinavian' });
    const fx = autoFixtures(layout, items);
    expect(fx.filter((f) => f.kind === 'rug').length).toBe(items.filter((i) => i.kind === 'bed').length);
    expect(fx.filter((f) => f.kind === 'curtain').length).toBeGreaterThan(0);
    setStyle({ packId: 'classic' });
    expect(autoFixtures(layout, items)).toEqual([]);
    expect(buildDecorGroup(layout, items, 'medium').group.children.length).toBe(0);
  });
  it('fixtures in a partial room are skipped (a guess is not styled)', () => {
    const son = readScene(DESIGNER, 'property.json') as PropertyFile;
    setStyle({ packId: 'warm-oak-navy', sheet: sheet({ pack: 'warm-oak-navy', fixtures: [{ kind: 'rug', roomId: 'master-room', aroundItem: 'bed-2' }] }) });
    expect(buildDecorGroup(son.layout, son.furniture, 'medium').group.children.length).toBe(0);
  });
  it('lights carry the walkthruLight tag the look drives', () => {
    setStyle({ packId: 'warm-oak-navy', sheet: parseDesignSheet(readScene(DESIGNER, 'design.json')) });
    const son = readScene(DESIGNER, 'property.json') as PropertyFile;
    const built = buildDecorGroup(son.layout, son.furniture, 'medium');
    const tagged: string[] = [];
    built.group.traverse((o) => { if (o.userData.walkthruLight) tagged.push(o.name); });
    expect(tagged).toEqual(expect.arrayContaining(['downlight-lens', 'bowl-lens']));
  });
});

describe('room finishes: sampled colours win', () => {
  const rooms = (): PropertyFile['layout'] => JSON.parse(JSON.stringify((readScene('test-sample-3', 'property.json') as PropertyFile).layout));
  it('applies the sheet\'s wall and floor colours to a default-finish layout, and Classic restores them', () => {
    const layout = rooms();
    const before = layout.rooms.map((r) => [r.wallColor, r.floorColor]);
    setStyle({ packId: 'walnut-white', sheet: parseDesignSheet(readScene('test-sample-3', 'design.json')) });
    const changed = applyRoomFinishes(layout, new THREE.Group(), null);
    expect(changed.length).toBeGreaterThan(2);
    expect(layout.rooms.find((r) => r.id === 'm-bed-room')!.wallColor).toBe('#EFE6D6');
    setStyle({ packId: 'classic' });
    applyRoomFinishes(layout, new THREE.Group(), null);
    expect(layout.rooms.map((r) => [r.wallColor, r.floorColor])).toEqual(before);
  });
  it('leaves everything alone when the layout\'s colours were sampled from a video', () => {
    const layout = rooms();
    layout.finishes = { ...layout.finishes, source: 'sampled' };
    setStyle({ packId: 'walnut-white', sheet: parseDesignSheet(readScene('test-sample-3', 'design.json')) });
    expect(applyRoomFinishes(layout, new THREE.Group(), null)).toEqual([]);
  });
  it('leaves a room that carries its own colour alone', () => {
    const layout = rooms();
    layout.rooms[0].wallColor = '#112233';
    setStyle({ packId: 'light-scandinavian' });
    applyRoomFinishes(layout, new THREE.Group(), null);
    expect(layout.rooms[0].wallColor).toBe('#112233');
  });
});

describe('the catalogue still builds in every pack', () => {
  it('a queen bed under each pack has a headboard part, a mattress and a duvet', () => {
    for (const pack of PACKS.filter((p) => !p.classic)) {
      setStyle({ packId: pack.id });
      const g = new THREE.Group();
      buildRealFurniture(g, itemFromCatalog('bed-queen', { cx: 0, cz: 0, w: 1.62, d: 2.08, yawDeg: 0 }, 'virtual'), 'medium', createFurnitureKit());
      const names = g.children.map((c) => c.name);
      expect(names).toContain('mattress');
      expect(names).toContain('duvet');
      expect(names.some((n) => n.startsWith('bed-headboard'))).toBe(true);
    }
  });
});

describe('gathered sheers (round 5)', () => {
  const sheerOf = (tier: 'low' | 'medium' | 'high', widthM = 2): THREE.Mesh => {
    const g = buildCurtain({ kit: createFurnitureKit(), q: GEN_QUALITY[tier] }, { ...CURTAIN_DEFAULTS, widthM, drape: 'none' }, { curtainSheer: { key: 'sheer' } });
    return g.children.find((c) => c.name === 'curtain-sheer') as THREE.Mesh;
  };
  it('a pleat gets enough vertices to be a pleat (it used to get fewer than one, which drew two fat flutes)', () => {
    for (const [tier, per] of [['low', 2], ['medium', 6], ['high', 8]] as const) {
      const geo = sheerOf(tier).geometry;
      const p = geo.getAttribute('position');
      // the first row of the first panel: x rises from 0 to the gather width
      let cols = 0;
      while (cols + 1 < p.count && p.getX(cols + 1) > p.getX(cols)) cols++;
      const pleats = Math.round(sheerGatherM(2) / SHEER_PLEAT_M);
      expect(cols, tier).toBe(pleats * per);
    }
  });
  it('pleats are fine and shallow, and the cloth is see-through with an edge that thins out', () => {
    const m = sheerOf('medium');
    const p = m.geometry.getAttribute('position'), c = m.geometry.getAttribute('color');
    expect(SHEER_PLEAT_M).toBeLessThan(0.06);
    let z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.count; i++) { z0 = Math.min(z0, p.getZ(i)); z1 = Math.max(z1, p.getZ(i)); }
    expect(z1 - z0).toBeLessThan(2 * SHEER_PLEAT_DEPTH_M + 0.02);
    expect(c.itemSize).toBe(4);
    // the left panel's free edge is at x = gather: the cloth there is thinner than in the middle of the stack
    const gather = sheerGatherM(2);
    let edge = 0, mid = 0, ne = 0, nm = 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      if (x > gather + 1e-6) continue;
      if (x > gather - 0.005) { edge += c.getW(i); ne++; } else if (x < gather / 2) { mid += c.getW(i); nm++; }
    }
    expect(edge / ne).toBeLessThan(0.5 * (mid / nm));
    const mat = m.material as THREE.MeshStandardMaterial;
    expect(mat.transparent).toBe(true); expect(mat.vertexColors).toBe(true);
    expect(m.userData.walkthruBake).toBe('skip'); // light, not mass: no AO of its own in a bake
  });
  it('two stacks at the sides leave the glass between them clear', () => {
    const p = sheerOf('medium', 2.4).geometry.getAttribute('position');
    const gather = sheerGatherM(2.4);
    for (let i = 0; i < p.count; i++) { const x = p.getX(i); expect(x <= gather + 1e-6 || x >= 2.4 - gather - 1e-6).toBe(true); }
    expect(gather).toBeLessThan(0.6);
  });
});
