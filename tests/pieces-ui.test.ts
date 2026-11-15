// The rest of the second catalogue table: poses and prompts, the cards a walker sees, the tray's category selector and search, the swing's motion
// (and that it stops, and that reduced motion keeps it still), the finishes and "Surprise me" of the new families, the packs' roles, and the
// fixtures the drawing reader recognised.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CATALOG, catalogItem, itemFromCatalog } from '../src/core/catalog';
import { checkFor } from '../src/core/checks';
import { clearFixtureSources, facingYawDeg, fixtureSizeNote, fixturesToItems } from '../src/core/fixtures';
import { validateProperty } from '../src/core/layout-validate';
import { CATEGORIES, PIECE_RULES, categoryOf, pieceRule } from '../src/core/pieces';
import { swingSeatPose } from '../src/core/poses';
import { fixturesFromExtras } from '../src/buyer/fixtures-load';
import { categoryCounts, filterCatalog } from '../src/buyer/catalog-tray';
import { pieceAction, pieceSeatPose } from '../src/buyer/piece-actions';
import { createSwingMotion, restSwingMesh, swingAngle, swingOffsets, swingPeriodS } from '../src/buyer/swing-motion';
import { actionFor } from '../src/buyer/store';
import { FAMILY_SLOTS, finishFamily, sanitizeFinish, surpriseFinish, swatch, finishSchemes } from '../src/look/finishes';
import { buildRealFurniture } from '../src/look/furniture-real';
import { createFurnitureKit } from '../src/look/furniture-materials';
import { PACKS } from '../src/look/packs';
import { finishLayer, resetStyle, resolveLook, setStyle } from '../src/look/style';
import { setGenCeiling } from '../src/look/gen/ceiling';
import type { FurnitureItem } from '../src/types';

const item = (id: string, over: Partial<FurnitureItem> = {}): FurnitureItem => {
  const s = catalogItem(id);
  return { ...itemFromCatalog(id, { cx: 2, cz: 2, w: s.footprint.w, d: s.footprint.d, yawDeg: 0 }, 'virtual'), ...over };
};

describe('prompts and poses', () => {
  it('every piece has an action: a swing and a chair and a recliner sit, a bed and a mat lie, a basin and a sink stand, the rest show their size', () => {
    for (const c of CATALOG.slice(14)) {
      const a = pieceAction({ catalogId: c.id })!;
      expect(a, c.id).not.toBeNull();
      expect(['lie', 'sit', 'stand', 'dims']).toContain(a.action);
      expect(a.prompt.length).toBeGreaterThan(3);
    }
    expect(pieceAction({ catalogId: 'swing-2' })).toEqual({ action: 'sit', prompt: 'Sit on the swing', upPrompt: 'Get up' });
    expect(pieceAction({ catalogId: 'hang-chair' })!.prompt).toBe('Sit in the hanging chair');
    expect(pieceAction({ catalogId: 'basin-wall' })).toMatchObject({ action: 'stand', prompt: 'Stand at the basin' });
    expect(pieceAction({ catalogId: 'yoga-mat' })!.action).toBe('lie');
    expect(pieceAction({ catalogId: 'fridge-1' })!.action).toBe('dims');
    expect(pieceAction({ catalogId: 'cot' })!.action).toBe('dims'); // a baby cot is not for lying on
    expect(pieceAction({ catalogId: 'sofa-3' })).toBeNull(); // the original table keeps the kind's action
    expect(actionFor('sofa').action).toBe('sit');
  });
  it('sit on the swing: hips on the plank (a little behind its middle), facing the front, at the seat spot nearest the walker, with the standard seat height', () => {
    const sw = item('swing-3', { box: { cx: 3, cz: 2, w: 1.6, d: 0.62, yawDeg: 90 } });
    const p = swingSeatPose(sw, 1.75, { x: 3, z: 2.9 });
    expect(p.yawDeg).toBe(90);
    // yaw 90: front is +x; width axis b = (cos, -sin) = (0, -1): a walker at larger z is on the -b side, so the seat spot is at larger z
    expect(p.root.z).toBeCloseTo(2.5, 6); // the far end of a 1.6 m plank: 0.5 m off centre (a person is 0.3 m from each end)
    expect(p.rootY).toBeCloseTo(Math.max(-0.02, 0.45 - 0.26 * 1.75), 6);
    expect(pieceSeatPose(sw, 1.75, { x: 3, z: 2.9 })).toEqual(p);
    const two = item('swing-2', { box: { cx: 3, cz: 2, w: 1.3, d: 0.58, yawDeg: 0 } });
    expect(swingSeatPose(two, 1.75, { x: 5, z: 2 }).root.x).toBeCloseTo(3.35, 6); // a two-seater has a seat spot at each side, 35 cm off centre
    expect(swingSeatPose(two, 1.75, { x: 3.05, z: 2 }).root.x).toBeCloseTo(3.05, 6);
    // a chair sits over its middle, a stool too
    expect(pieceSeatPose(item('bar-stool'), 1.75, { x: 0, z: 0 })!.rootY).toBeCloseTo(Math.max(-0.02, 0.75 - 0.26 * 1.75), 6);
  });
});

describe('cards', () => {
  const card = (id: string, H = 1.75, ceiling = 2.7) => checkFor(item(id), H, ceiling);
  it('a swing card: seat height, how many it seats, how far it travels each way on this ceiling', () => {
    const c = card('swing-2');
    expect(c.headline).toBe('Seats 2.');
    expect(c.lines.join(' ')).toMatch(/Swings about \d+ cm each way \(20° on 208 cm of chain\)/);
    expect(card('swing-3').headline).toBe('Seats 3.');
    expect(card('hang-chair').headline).toBe('Seats one.');
    expect(c.footer).toContain('Hanging needs a structural hook');
    // a lower ceiling, shorter chains, less travel
    const low = checkFor(item('swing-2'), 1.75, 2.4).lines.join(' ');
    expect(low).toContain('178 cm of chain');
  });
  it('the sofa-bed and the recliner say what they need open; a fridge shows its size and its door; wall pieces say how high they are fixed', () => {
    expect(card('sofa-bed').lines.join(' ')).toContain('Needs 100 cm clear in front (opened bed 190 × 190 cm');
    expect(card('recliner').lines.join(' ')).toContain('about 150 cm long open');
    const f = card('fridge-1');
    expect(f.headline).toBe('58 × 67 × 145 cm');
    expect(f.lines.join(' ')).toContain('the door is 58 cm wide, opened to 90°');
    expect(card('geyser-25').lines.join(' ')).toContain('underside 190 cm above the floor');
  });
  it('a basin or a sink is judged for a rim at its standard height, not as a work counter', () => {
    expect(card('basin-wall').tone).toBe('good');
    expect(card('basin-wall').headline).toContain('Comfortable');
    expect(card('basin-wall', 1.2).tone).toBe('warn'); // a child at an 85 cm rim
  });
  it('a yoga mat and a bunk bed use the lying card: the mat says you fit, with the spare length', () => {
    const y = card('yoga-mat', 1.6);
    expect(y.headline).toBe('You fit.');
    expect(card('yoga-mat').headline).toBe('Tight fit.'); // 8 cm to spare at 175 cm
    expect(y.lines[0]).toContain('cm to spare');
    expect(card('bunk-bed').title).toContain('91 × 183');
    expect(card('yoga-mat', 1.95).headline).toBe('Too short for you.');
  });
  it('chairs, stools and bean bags use the seat height verdict with the standard-size note', () => {
    for (const id of ['bar-stool', 'office-chair', 'bean-bag', 'balcony-chair']) {
      const c = card(id);
      expect(c.headline, id).toMatch(/Seat height \d+ cm/);
      expect(c.footer, id).toBeTruthy();
    }
  });
  it('every new piece has a card with a title and a headline', () => {
    for (const c of CATALOG.slice(14)) {
      const k = card(c.id);
      expect(k.title.length, c.id).toBeGreaterThan(2);
      expect(k.headline.length, c.id).toBeGreaterThan(2);
    }
  });
});

describe('the tray: category selector and search', () => {
  it('every category has pieces, the counts add up, and the order is the catalogue\'s', () => {
    const counts = categoryCounts();
    expect(counts.all).toBe(CATALOG.length);
    let sum = 0;
    for (const c of CATEGORIES) { expect(counts[c.id], c.id).toBeGreaterThan(0); sum += counts[c.id]; }
    expect(sum).toBe(CATALOG.length);
    expect(filterCatalog('all', '').map((c) => c.id)).toEqual(CATALOG.map((c) => c.id));
  });
  it('a category narrows to its pieces', () => {
    expect(filterCatalog('swing', '').map((c) => c.id)).toEqual(['swing-2', 'swing-3', 'swing-2-frame', 'swing-3-frame', 'hang-chair', 'hang-chair-stand']);
    expect(filterCatalog('bathroom', '').length).toBe(18);
    expect(filterCatalog('seating', '').map((c) => c.id)).toContain('sofa-3');
    expect(filterCatalog('beds', '').map((c) => c.id)).toContain('bed-king');
    expect(filterCatalog('kitchen', '').map((c) => c.id)).toContain('sink-double');
    expect(filterCatalog('kids', '').map((c) => c.id)).toEqual(['cot', 'kids-desk']);
  });
  it('search finds by name, by Indian words and by size, and every word must match', () => {
    expect(filterCatalog('all', 'jhula').map((c) => c.id)).toEqual(['swing-2', 'swing-3', 'swing-2-frame', 'swing-3-frame']);
    expect(filterCatalog('all', 'fridge').map((c) => c.id)).toEqual(['fridge-1', 'fridge-2', 'fridge-sbs']);
    expect(filterCatalog('all', 'FRIDGE side').map((c) => c.id)).toEqual(['fridge-sbs']);
    expect(filterCatalog('all', 'mandir').map((c) => c.id)).toEqual(['mandir-floor', 'mandir-wall']);
    expect(filterCatalog('all', 'godrej').map((c) => c.id)).toEqual(['steel-almirah']);
    expect(filterCatalog('all', 'bean')[0].id).toBe('bean-bag');
    expect(filterCatalog('all', 'geyser 25').map((c) => c.id)).toEqual(['geyser-25']);
    expect(filterCatalog('all', 'zzzz')).toEqual([]);
    expect(filterCatalog('kitchen', 'jhula')).toEqual([]);
    expect(filterCatalog('all', '  tv ,  65 ').map((c) => c.id)).toEqual(['tv-unit-180']);
  });
});

describe('the swing moves while a walker sits, and stops', () => {
  const rigMesh = (mode: 'parallel' | 'rigid' = 'parallel'): THREE.Group => {
    const g = new THREE.Group();
    g.userData.swingRig = { mode, hookY: 2.7, pivotZ: 0, chainZ: [0.27, -0.25], lengthM: 2.08 };
    for (const n of mode === 'parallel' ? ['swing-seat', 'swing-chains-front', 'swing-chains-back'] : ['swing-rig']) { const o = new THREE.Group(); o.name = n; g.add(o); }
    return g;
  };
  it('the pendulum: period from the chain length, eased in from rest, a gentle amplitude', () => {
    expect(swingPeriodS(2.08)).toBeCloseTo(2.893, 2);
    expect(swingAngle(0, 2.08)).toBe(0);
    expect(Math.abs(swingAngle(0.72, 2.08))).toBeGreaterThan(0.05);
    const peak = Math.max(...Array.from({ length: 400 }, (_, i) => Math.abs(swingAngle(i * 0.05 + 8, 2.08))));
    expect(peak).toBeLessThanOrEqual((12 * Math.PI) / 180 + 1e-9);
    expect(peak).toBeGreaterThan((11 * Math.PI) / 180);
    const o = swingOffsets(2.08, (12 * Math.PI) / 180);
    expect(o.forward).toBeCloseTo(0.4325, 3);
    expect(o.up).toBeGreaterThan(0);
    expect(o.up).toBeLessThan(0.05);
  });
  it('seated: the seat and the chains move and the walker rides along the swing\'s front; on getting up everything is at rest again', () => {
    const mesh = rigMesh();
    const rides: Array<{ dx: number; dy: number; dz: number; pitchRad: number } | null> = [];
    const m = createSwingMotion({ ridePose: (o) => rides.push(o), meshOf: () => mesh }, () => false);
    const sitting = { id: 'sw', box: { yawDeg: 90 } };
    for (let i = 0; i < 40; i++) m.update(0.05, sitting);
    expect(m.active()).toBe('sw');
    const seat = mesh.getObjectByName('swing-seat')!;
    expect(Math.abs(seat.position.z)).toBeGreaterThan(0.01);
    expect(mesh.getObjectByName('swing-chains-front')!.rotation.x).not.toBe(0);
    const last = rides[rides.length - 1]!;
    // yaw 90: the front is +x, so the walker moves in x by what the seat moves forward, and not in z
    expect(last.dx).toBeCloseTo(seat.position.z, 6);
    expect(Math.abs(last.dz)).toBeLessThan(1e-9);
    expect(last.pitchRad).toBe(0);
    m.update(0.05, null);
    expect(m.active()).toBeNull();
    expect(seat.position.toArray()).toEqual([0, 0, 0]);
    expect(mesh.getObjectByName('swing-chains-front')!.rotation.x).toBe(0);
    expect(rides[rides.length - 1]).toBeNull();
  });
  it('a hanging chair turns as one with its chain, and the walker tilts with it', () => {
    const mesh = rigMesh('rigid');
    const rides: Array<{ pitchRad: number } | null> = [];
    const m = createSwingMotion({ ridePose: (o) => rides.push(o), meshOf: () => mesh }, () => false);
    for (let i = 0; i < 40; i++) m.update(0.05, { id: 'c', box: { yawDeg: 0 } });
    const rot = mesh.getObjectByName('swing-rig')!.rotation.x;
    expect(Math.abs(rot)).toBeGreaterThan(0.01);
    expect(rides[rides.length - 1]!.pitchRad).toBeCloseTo(rot, 9);
    restSwingMesh(mesh);
    expect(mesh.getObjectByName('swing-rig')!.rotation.x).toBe(0);
  });
  it('respects reduced motion: nothing moves, the walker still sits', () => {
    const mesh = rigMesh();
    const rides: unknown[] = [];
    const m = createSwingMotion({ ridePose: (o) => rides.push(o), meshOf: () => mesh }, () => true);
    for (let i = 0; i < 40; i++) m.update(0.05, { id: 'sw', box: { yawDeg: 0 } });
    expect(m.active()).toBeNull();
    expect(mesh.getObjectByName('swing-seat')!.position.toArray()).toEqual([0, 0, 0]);
    expect(rides.filter((r) => r !== null)).toEqual([]);
  });
  it('a mesh that is not a generated swing (the plain boxes) is left alone', () => {
    const m = createSwingMotion({ ridePose: () => { throw new Error('should not ride'); }, meshOf: () => new THREE.Group() }, () => false);
    expect(() => { for (let i = 0; i < 5; i++) m.update(0.05, { id: 'x', box: { yawDeg: 0 } }); }).not.toThrow();
  });
  it('a generated swing carries its rig and its moving groups, at the identity transform at rest', () => {
    setStyle({ packId: 'light-scandinavian' });
    setGenCeiling(2.6);
    for (const id of ['swing-2', 'swing-3', 'swing-2-frame', 'swing-3-frame', 'hang-chair', 'hang-chair-stand']) {
      const g = new THREE.Group();
      buildRealFurniture(g, item(id), 'medium', createFurnitureKit());
      const rig = g.userData.swingRig;
      expect(rig, id).toBeTruthy();
      const names = rig.mode === 'parallel' ? ['swing-seat', 'swing-chains-front', 'swing-chains-back'] : ['swing-rig'];
      for (const n of names) {
        const o = g.getObjectByName(n)!;
        expect(o, `${id} ${n}`).toBeTruthy();
        expect(o.rotation.x).toBe(0);
        if (n === 'swing-seat') expect(o.position.toArray()).toEqual([0, 0, 0]);
      }
      // the chains' top is at the hook height: the home's ceiling for a hung one
      const hung = id === 'swing-2' || id === 'swing-3' || id === 'hang-chair';
      expect(rig.hookY).toBeCloseTo(hung ? 2.6 : 1.88, 6);
    }
    // the hooks of a hung bench are four plates at the ceiling, at the chains' rectangle
    const g = new THREE.Group();
    buildRealFurniture(g, item('swing-2'), 'medium', createFurnitureKit());
    const hooks = g.children.filter((c) => c.name === 'swing-hooks')[0] as THREE.Mesh;
    hooks.geometry.computeBoundingBox();
    expect(hooks.geometry.boundingBox!.max.y).toBeCloseTo(2.6, 3);
    expect(hooks.geometry.boundingBox!.max.x - hooks.geometry.boundingBox!.min.x).toBeGreaterThan(1.1);
    resetStyle(); setGenCeiling(2.7);
  });
});

describe('finishes of the new families', () => {
  it('every rule names a family that has slots, and every slot option is a swatch', () => {
    for (const r of Object.values(PIECE_RULES)) {
      if (!r.family) continue;
      expect(FAMILY_SLOTS[r.family], r.id).toBeDefined();
      for (const s of FAMILY_SLOTS[r.family]) for (const o of s.options) if (s.key !== 'style') expect(swatch(o), `${r.family}.${s.key} ${o}`).not.toBeNull();
    }
  });
  it('finishFamily follows the rule, whatever the kind', () => {
    expect(finishFamily(item('swing-2'))).toBe('swing');
    expect(finishFamily(item('tv-unit-150'))).toBe('storage');
    expect(finishFamily(item('fridge-1'))).toBe('appliance');
    expect(finishFamily(item('bean-bag'))).toBe('pouf');
    expect(finishFamily(item('bunk-bed'))).toBe('bunk');
    expect(finishFamily(item('wc-western'))).toBe('sanitary');
    expect(finishFamily(item('sofa-3'))).toBe('sofa');
    expect(finishFamily(item('bed-king'))).toBe('bed');
  });
  it('"Surprise me" gives a coherent combination that the family accepts, never the one it has', () => {
    for (const fam of ['swing', 'storage', 'appliance', 'pouf', 'bunk', 'plain', 'sanitary'] as const) {
      const schemes = finishSchemes(fam);
      expect(schemes.length, fam).toBeGreaterThanOrEqual(4);
      for (const s of schemes) expect(sanitizeFinish(fam, s), fam).toEqual(s);
      const a = surpriseFinish(fam, undefined, () => 0.1);
      const b = surpriseFinish(fam, a, () => 0.1);
      expect(b).not.toEqual(a);
    }
  });
  it('a viewer pick reaches the generated piece: a swing\'s chains and wood, a fridge colour, the fittings of a basin', () => {
    setStyle({ packId: 'light-scandinavian' });
    const colourOf = (id: string, finish: FurnitureItem['finish'], part: string): string => {
      const it = item(id, { finish });
      const g = new THREE.Group();
      buildRealFurniture(g, it, 'medium', createFurnitureKit());
      let hex = '';
      g.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.name === part) hex = `#${(m.material as THREE.MeshStandardMaterial).color.getHexString()}`.toUpperCase(); });
      return hex;
    };
    expect(colourOf('swing-2', { secondary: 'metal-brass' }, 'swing-eyes').length).toBe(7);
    const a = colourOf('swing-2', undefined, 'swing-seat-plank');
    const b = colourOf('swing-2', { primary: 'wood-wenge' }, 'swing-seat-plank');
    expect(b).not.toBe(a);
    expect(colourOf('swing-2', { secondary: 'metal-black' }, 'swing-hooks')).not.toBe(colourOf('swing-2', { secondary: 'metal-brass' }, 'swing-hooks'));
    expect(colourOf('fridge-1', { primary: 'lam-navy' }, 'fridge-body')).toBe('#2D3D5C');
    expect(colourOf('basin-wall', { secondary: 'metal-brass' }, 'tap')).not.toBe(colourOf('basin-wall', undefined, 'tap'));
    resetStyle();
  });
  it('the viewer\'s pick wins over the catalogue row\'s own params only where it means something (a storage bed keeps its box base)', () => {
    setStyle({ packId: 'light-scandinavian' });
    expect(resolveLook(item('bed-single-storage'))!.params.base).toBe('box');
    expect(resolveLook(item('bed-single-storage', { finish: { style: 'panel' } }))!.params.base).toBe('platform');
    expect(finishLayer('swing', { primary: 'wood-oak', secondary: 'metal-steel', fabric: 'fab-teal' }).roles).toMatchObject({ case: 'wood-oak', chain: 'metal-steel', cushion: 'fab-teal' });
    resetStyle();
  });
  it('Classic has no old builders for these, so they take the walnut and white finishes and are still drawn by a generator', () => {
    setStyle({ packId: 'classic' });
    const look = resolveLook(item('swing-2'));
    expect(look).not.toBeNull();
    expect(look!.kind).toBe('swing');
    expect(resolveLook(item('sofa-3'))).toBeNull();
    resetStyle();
  });
});

describe('style packs give the new families their roles', () => {
  it('every pack names the chain, the swing wood, the appliance body and trim, and the fittings', () => {
    for (const p of PACKS.filter((x) => !x.classic)) {
      for (const r of ['chain', 'swingWood', 'applianceBody', 'applianceTrim', 'fittings']) expect(p.roles[r], `${p.id} ${r}`).toBeTruthy();
      for (const k of ['swing', 'tvunit', 'cabinet', 'tablex', 'seatx'] as const) expect(p.generators[k], `${p.id} ${k}`).toBeDefined();
    }
  });
  it('the packs differ: the same swing is drawn with different chains and wood', () => {
    const chains = new Set(PACKS.filter((p) => !p.classic).map((p) => p.roles.chain));
    expect(chains.size).toBe(3);
  });
});

describe('fixtures the drawing reader recognised', () => {
  const property = validateProperty(JSON.parse(readFileSync('public/scenes/test-sample-3/property.json', 'utf8')));
  const extras = JSON.parse(readFileSync('public/scenes/test-sample-3/proposal-extras.json', 'utf8'));
  const layout = property.layout;
  it('the scene file carries fixtures that parse', () => {
    const f = fixturesFromExtras(extras);
    expect(f.map((x) => x.cls).sort()).toEqual(['basin', 'basin', 'shower', 'shower', 'sink', 'wc', 'wc']);
  });
  it('become real items of the matching piece at the drawn place, tagged by id', () => {
    clearFixtureSources();
    const items = fixturesToItems(fixturesFromExtras(extras), layout);
    const wc = items.find((i) => i.id === 'fx-wc-1')!;
    expect(wc.source).toBe('real');
    expect(wc.catalogId).toBe('wc-western');
    expect(wc.kind).toBe('counter');
    expect(wc.box.cx).toBeCloseTo(-5.0, 6);
    expect(wc.box.cz).toBeCloseTo(3.31, 6);
    expect(wc.heightM).toBeCloseTo(0.8, 6);
  });
  it('take the symbol\'s size when it is believable, the standard size (labelled) when there is none or it is not', () => {
    clearFixtureSources();
    const items = fixturesToItems(fixturesFromExtras(extras), layout);
    const byId = (id: string): FurnitureItem => items.find((i) => i.id === id)!;
    expect(byId('fx-wc-1').box.w).toBeCloseTo(0.39, 6);
    expect(byId('fx-wc-1').box.d).toBeCloseTo(0.7, 6);
    expect(fixtureSizeNote('fx-wc-1')).toContain("from the drawing's symbol");
    expect(byId('fx-wc-2').box.w).toBeCloseTo(0.4, 6);
    expect(byId('fx-wc-2').box.d).toBeCloseTo(0.72, 6);
    expect(fixtureSizeNote('fx-wc-2')).toContain('Standard size, not on the drawing');
    // the drawn basin was 46 x 55: the long side is its width
    expect(byId('fx-basin-1').box.w).toBeCloseTo(0.55, 6);
    expect(byId('fx-basin-1').box.d).toBeCloseTo(0.46, 6);
    // a symbol far from a basin's size is not believed
    const odd = fixturesToItems([{ id: 'b', cls: 'basin', at: { x: -5.4, z: 2.3 }, sizeM: { w: 2.5, d: 0.2 } }], layout)[0];
    expect(odd.box.w).toBeCloseTo(0.55, 6);
    expect(fixtureSizeNote('fx-b')).toContain('Standard size');
    expect(fixtureSizeNote('not-a-fixture')).toBeNull();
  });
  it('face into their room with their back to the nearest wall', () => {
    // toilet-1 spans x -5.74..-4.14, z 1.14..3.69: a WC at its south wall faces north (-z) and the basin on its west wall faces east (+x)
    const wcYaw = facingYawDeg(layout, { x: -5.0, z: 3.31 });
    expect(Math.round(wcYaw)).toBe(180);
    const basinYaw = facingYawDeg(layout, { x: -5.495, z: 2.3 });
    expect(Math.round(basinYaw)).toBe(90);
    expect(facingYawDeg(layout, { x: 99, z: 99 })).toBe(0);
  });
  it('a sink the drawing draws inside a counter it already has is not drawn twice, and a hob has no piece', () => {
    const items = fixturesToItems(fixturesFromExtras(extras), layout, property.furniture);
    expect(items.some((i) => i.id === 'fx-sink-1')).toBe(false);
    expect(items.some((i) => i.id === 'fx-wc-1')).toBe(true);
    expect(fixturesToItems([{ id: 'h', cls: 'hob', at: { x: 0, z: 0 } }], layout)).toEqual([]);
  });
  it('a card says where the size came from, and a drawn fixture is read from the drawing, not checked as a placement', () => {
    clearFixtureSources();
    const items = fixturesToItems(fixturesFromExtras(extras), layout);
    const c = checkFor(items.find((i) => i.id === 'fx-basin-1')!, 1.75, 2.6);
    expect(c.footer).toContain("Width and depth are from the drawing's symbol");
    expect(c.footer).toContain('Height is a standard assumption');
  });
  it('bad records are dropped', () => {
    expect(fixturesFromExtras(null)).toEqual([]);
    expect(fixturesFromExtras({ fixtures: [{ id: 'a', cls: 'bed', at: { x: 0, z: 0 } }, { id: 'b', cls: 'wc' }, { id: 'c', cls: 'wc', at: { x: 'x', z: 1 } }, { id: 'd', cls: 'wc', at: { x: 0, z: 1 }, sizeM: { w: -1, d: 1 } }, { id: 'd', cls: 'wc', at: { x: 0, z: 1 } }] }))
      .toEqual([{ id: 'd', cls: 'wc', at: { x: 0, z: 1 } }]);
  });
});

describe('the catalogue is a table of rules the rest of the app can rely on', () => {
  it('every id in CATALOG is either one of the first fourteen or has exactly one rule', () => {
    for (const c of CATALOG.slice(14)) expect(pieceRule(c.id), c.id).not.toBeNull();
    for (const c of CATALOG.slice(0, 14)) expect(pieceRule(c.id), c.id).toBeNull();
    for (const c of CATALOG) expect(CATEGORIES.map((x) => x.id)).toContain(categoryOf(c.id));
  });
});
