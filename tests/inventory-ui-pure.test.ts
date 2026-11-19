// The pure parts of the inventory picker, the admin page, the client and the walk's direction aids (SPEC 22).
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import { parseBuilding } from '../src/building/parse';
import { buildingUrl, parseBuildingUrl } from '../src/building/url';
import { byFloor, findUnit, generateUnits, unitsOf } from '../src/building/units';
import { COLOURS, PITCH_MAX, PITCH_MIN, cellColour, clampOrbit, dragOrbit, framing, orbitPosition, shortType, towerGeometry } from '../src/building/tower-model';
import { unitArea, unitFacing } from '../src/building/unit-info';
import { unitFromHash } from '../src/building/inventory-picker';
import { problemText, sheetOf, totals } from '../src/admin/model';
import { DEMO_TAG, fetchInventory, forgetInventory, sendChange, statusWord, tally, vastuEnabledFor } from '../src/inventory/client';
import type { InventoryOk } from '../src/inventory/types';
import { cardLines, dialState, edgeMarks, facingLines, resolveNorth, zoneWord } from '../src/buyer/directions/model';
import { readFacing } from '../src/core/facing';
import { validateProperty } from '../src/core/layout-validate';
import { northInScene } from '../src/core/north';
import type { SceneInfo } from '../src/building/load';

const read = <T>(f: string): T => JSON.parse(fs.readFileSync(f, 'utf8')) as T;
const tower = () => parseBuilding(read('public/buildings/sample-tower/building.json'));
const sceneOf = (id: string): SceneInfo => ({ property: validateProperty(read(`public/scenes/${id}/property.json`)), unverified: {} });

describe('the tower\'s boxes', () => {
  const b = tower();
  const units = unitsOf(b);
  const g = towerGeometry(units, { floorH: b.floorToFloorM, firstFloor: b.units!.firstFloor });
  it('one box per unit, four across and twenty high, all distinct and standing on the ground or the base', () => {
    expect(g.cells).toHaveLength(80);
    expect(g.floors).toBe(20); expect(g.perFloor).toBe(4);
    expect(new Set(g.cells.map((c) => `${c.x.toFixed(2)}/${c.y.toFixed(2)}/${c.z.toFixed(2)}`)).size).toBe(80);
    expect(g.base).not.toBeNull();
    expect(Math.min(...g.cells.map((c) => c.y - c.h / 2))).toBeGreaterThanOrEqual(g.base!.h - 1e-9);
  });
  it('a floor is one row: every unit of it is at the same height and at its own place along the row', () => {
    const f12 = g.cells.filter((c) => c.unit.floor === 12);
    expect(new Set(f12.map((c) => c.y)).size).toBe(1);
    expect(f12.map((c) => c.x)).toEqual([...f12.map((c) => c.x)].sort((a, b2) => a - b2));
    expect(new Set(f12.map((c) => c.z)).size).toBe(1);
  });
  it('units never overlap', () => {
    for (let i = 0; i < g.cells.length; i++) for (let j = i + 1; j < g.cells.length; j++) {
      const a = g.cells[i], c = g.cells[j];
      const over = Math.abs(a.x - c.x) < (a.w + c.w) / 2 - 1e-9 && Math.abs(a.y - c.y) < (a.h + c.h) / 2 - 1e-9 && Math.abs(a.z - c.z) < (a.d + c.d) / 2 - 1e-9;
      expect(over).toBe(false);
    }
  });
  it('is generic: one unit a floor, nine a floor (two rows), no base', () => {
    const one = towerGeometry(generateUnits({ firstFloor: 1, floors: 3, perFloor: [{ number: 1, type: 'a' }] }));
    expect(one.cells).toHaveLength(3); expect(one.base).toBeNull(); expect(one.perFloor).toBe(1);
    const nine = towerGeometry(generateUnits({ firstFloor: 1, floors: 2, perFloor: Array.from({ length: 9 }, (_, i) => ({ number: i + 1, type: 'a' })) }));
    expect(nine.cells).toHaveLength(18);
    expect(new Set(nine.cells.map((c) => c.z.toFixed(2))).size).toBe(2);
    expect(towerGeometry([]).cells).toEqual([]);
  });
  it('the camera fits the whole tower and stays inside its limits', () => {
    const fr = framing(g);
    for (const [fov, aspect] of [[34, 1.4], [34, 1], [42, 0.6]] as const) {
      const dist = fr.distFor(fov, aspect);
      const half = (g.box.y1 / 2) * 1.0;
      expect(dist * Math.tan((fov * Math.PI) / 360)).toBeGreaterThan(half); // the tower's half height fits the vertical field at that distance
    }
    const o = clampOrbit({ yaw: 9, pitch: 9, dist: 1e6 }, 100);
    expect(o.pitch).toBe(PITCH_MAX); expect(o.dist).toBe(150);
    expect(clampOrbit({ yaw: 0, pitch: -3, dist: 0 }, 100)).toMatchObject({ pitch: PITCH_MIN, dist: 45 });
    const d = dragOrbit({ yaw: 0, pitch: 0.3, dist: 100 }, 100, 0, 400, 100);
    expect(d.yaw).toBeLessThan(0); expect(d.pitch).toBe(0.3);
    const p = orbitPosition({ yaw: 0, pitch: 0, dist: 10 }, { x: 0, y: 5, z: 0 });
    expect(p).toEqual({ x: 0, y: 5, z: 10 });
  });
  it('colours by status: green, terracotta, grey for unknown (never green), cream when off, yellow when selected', () => {
    expect(cellColour('available', true, false, false)).toEqual(COLOURS.available);
    expect(cellColour('sold', true, false, false)).toEqual(COLOURS.sold);
    expect(cellColour(undefined, true, false, false)).toEqual(COLOURS.unknown);
    expect(cellColour(null, true, false, false)).toEqual(COLOURS.unknown);
    expect(cellColour('sold', false, false, false)).toEqual(COLOURS.neutral);
    expect(cellColour('sold', true, true, false)).toEqual(COLOURS.selected);
    expect(cellColour('sold', true, false, true).every((v, i) => v >= COLOURS.sold[i])).toBe(true);
    expect(shortType('2 BHK · 644 sq ft')).toBe('2 BHK');
  });
});

describe('the tower is cheap to colour (one material, instanced)', () => {
  it('the view makes one InstancedMesh with one material and writes colours into its own buffer', () => {
    const text = fs.readFileSync('src/building/tower-view.ts', 'utf8');
    expect(text).toMatch(/new THREE\.InstancedMesh\(box, material, g\.cells\.length\)/);
    expect(text).toMatch(/setColorAt/);
    expect(text).not.toMatch(/g\.cells\.forEach\([^)]*new THREE\.Mesh/); // never a mesh or a material per unit
    expect((text.match(/new THREE\.MeshLambertMaterial/g) ?? []).length).toBeLessThanOrEqual(3); // the units, the base, the ground
    expect(text).toMatch(/draws only when something changed|dirty/);
  });
});

describe('a unit\'s card', () => {
  const b = tower();
  it('the area is the brochure figure with its source, for a flat the walk models and for one it does not', () => {
    const a = unitArea(b, findUnit(b, '203')!)!;
    expect(a.text).toBe('930 sq ft · 86.4 m²');
    expect(a.source).toMatch(/brochure/);
    const far = unitArea(b, findUnit(b, '1204')!)!;
    expect(far.text).toBe('1,117 sq ft · 103.76 m²');
  });
  it('a building that says only the type\'s name still gets an area, labelled as stated', () => {
    const j = read<Record<string, unknown>>('public/buildings/sample-tower/building.json');
    for (const l of (j.levels as { spaces: { notes?: string[] }[] }[])) for (const s of l.spaces) delete s.notes;
    const b2 = parseBuilding(j);
    const a = unitArea(b2, findUnit(b2, '1204')!)!;
    expect(a.text).toBe('1,117 sq ft');
    expect(a.source).toMatch(/Stated carpet area/);
  });
  it('says which way the flat faces from its own scene and the building\'s north; nothing without a north', async () => {
    const load = async (id: string): Promise<SceneInfo> => sceneOf(id);
    const f = (await unitFacing(b, findUnit(b, '1202')!, load))!;
    expect(f.balconies).toEqual(['E']); expect(f.door).toBe('W');
    expect((await unitFacing(b, findUnit(b, '1204')!, load))!.balconies).toEqual(['N']);
    const j = read<Record<string, unknown>>('public/buildings/sample-tower/building.json'); delete j.north;
    const b2 = parseBuilding(j);
    expect(await unitFacing(b2, findUnit(b2, '1202')!, load)).toBeNull();
    expect(await unitFacing(b, findUnit(b, '1202')!, async () => { throw new Error('gone'); })).toBeNull();
  });
  it('reads a unit from an address fragment, and refuses anything else', () => {
    expect(unitFromHash('#flat-1204')).toBe('1204');
    for (const h of ['', '#flat-', '#flat-12', '#flat-1204x', '#unit-1204', '#flat-1234567', '#flat-<b>']) expect(unitFromHash(h)).toBeNull();
  });
  it('carries a unit in the address of a walk and nowhere else', () => {
    expect(buildingUrl({ building: 'sample-tower', space: 'f2-204', unit: '1204' })).toBe('/?building=sample-tower&space=f2-204&unit=1204');
    expect(parseBuildingUrl('?building=sample-tower&space=f2-204&unit=1204')).toEqual({ building: 'sample-tower', space: 'f2-204', unit: '1204' });
    expect(parseBuildingUrl('?building=sample-tower&space=f2-204&unit=abc')).toEqual({ building: 'sample-tower', space: 'f2-204' });
    expect(buildingUrl({ building: 'sample-tower', space: 'f2-204', unit: 'x<y' })).toBe('/?building=sample-tower&space=f2-204');
  });
});

describe('the client: never a made-up status', () => {
  const ok: InventoryOk = { ok: true, building: 'b', units: { '201': 'sold' }, settings: { vastuEnabled: true, demo: true } };
  const reply = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  it('reads an answer, and is null for any trouble', async () => {
    forgetInventory();
    expect(await fetchInventory('b', { fresh: true, fetchImpl: reply(ok) })).toEqual(ok);
    expect(await fetchInventory('b', { fresh: true, fetchImpl: reply({ ok: false, error: 'not-configured', message: 'x' }, 503) })).toBeNull();
    expect(await fetchInventory('b', { fresh: true, fetchImpl: reply({ nonsense: 1 }) })).toBeNull();
    expect(await fetchInventory('b', { fresh: true, fetchImpl: reply({ ...ok, settings: { vastuEnabled: 'yes', demo: true } }) })).toBeNull();
    expect(await fetchInventory('b', { fresh: true, fetchImpl: (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch })).toBeNull();
    expect(await fetchInventory('b', { fresh: true, fetchImpl: (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch })).toBeNull();
  });
  it('the Vastu setting is false whenever the service cannot say', async () => {
    forgetInventory();
    expect(await vastuEnabledFor('b', { fresh: true, fetchImpl: reply(ok) })).toBe(true);
    expect(await vastuEnabledFor('b', { fresh: true, fetchImpl: reply({}, 500) })).toBe(false);
    expect(await vastuEnabledFor('b', { fresh: true, fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch })).toBe(false);
  });
  it('a change sends the passcode in a header, never in the address', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ ok: true, building: 'b', changed: true }), { status: 200 }));
    const r = await sendChange({ building: 'b', unit: '201', status: 'sold' }, 'sekrit', { fetchImpl: f as unknown as typeof fetch });
    expect(r.ok).toBe(true);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/inventory');
    expect(url).not.toMatch(/sekrit/);
    expect((init.headers as Record<string, string>)['x-admin-passcode']).toBe('sekrit');
    expect(String(init.body)).not.toMatch(/sekrit/);
    expect(init.method).toBe('POST');
  });
  it('a refused change reports why, and an unreachable server is a network problem', async () => {
    const bad = await sendChange({ building: 'b', unit: '201', status: 'sold' }, 'x', { fetchImpl: reply({ ok: false, error: 'unauthorized', message: 'no' }, 401) });
    expect(bad).toMatchObject({ ok: false, status: 401, error: 'unauthorized' });
    const net = await sendChange({ building: 'b', check: true }, 'x', { fetchImpl: (async () => { throw new Error('x'); }) as unknown as typeof fetch });
    expect(net).toMatchObject({ ok: false, error: 'network' });
  });
  it('words and counts: a unit with no status is "Status unavailable" and not counted as available', () => {
    expect(statusWord('available')).toBe('Available'); expect(statusWord('sold')).toBe('Sold');
    expect(statusWord(undefined)).toBe('Status unavailable'); expect(statusWord(null)).toBe('Status unavailable');
    expect(DEMO_TAG).toBe('Demo data');
    expect(tally(['1', '2', '3', '4'], { '1': 'sold', '2': 'available', '3': 'sold' })).toEqual({ available: 1, sold: 2, unknown: 1 });
    expect(tally(['1', '2'], null)).toEqual({ available: 0, sold: 0, unknown: 2 });
  });
});

describe('the admin sheet', () => {
  const b = tower();
  it('is the floors by the unit numbers, top floor first, with the building\'s own columns', () => {
    const s = sheetOf(b.units!, unitsOf(b));
    expect(s.columns.map((c) => c.number)).toEqual([1, 2, 3, 4]);
    expect(s.rows).toHaveLength(20);
    expect(s.rows[0].floor).toBe(21); expect(s.rows[19].floor).toBe(2);
    expect(s.rows[10].cells.map((c) => c?.id)).toEqual(['1101', '1102', '1103', '1104']);
  });
  it('totals count a unit without a status as not set, never as available', () => {
    const t = totals(unitsOf(b), { '201': 'sold', '202': 'available' });
    expect(t).toEqual({ available: 1, sold: 1, unknown: 78, total: 80 });
    expect(totals(unitsOf(b), null).unknown).toBe(80);
  });
  it('has a plain sentence for each way a try ends', () => {
    expect(problemText('admin-not-configured')).toMatch(/no passcode has been configured/);
    expect(problemText('unauthorized')).toMatch(/not right/);
    expect(problemText('rate-limited')).toMatch(/Wait a minute/);
    expect(problemText('network')).toMatch(/Could not reach/);
    expect(problemText('whatever')).toMatch(/did not work/);
  });
});

describe('the walk\'s direction aids', () => {
  it('picks the north: the building\'s, else the property\'s, else look.json\'s (turned the right way round), else none', () => {
    expect(resolveNorth({ host: { deg: 90, source: 'builder' }, property: { deg: 10, source: 'drawing' }, lookNorthDeg: 30 })).toEqual({ deg: 90, source: 'builder' });
    expect(resolveNorth({ property: { deg: 10, source: 'drawing' }, lookNorthDeg: 30 })).toEqual({ deg: 10, source: 'drawing' });
    expect(resolveNorth({ lookNorthDeg: 90 })).toEqual({ deg: 270, source: 'builder' });
    expect(resolveNorth({})).toBeNull();
    expect(resolveNorth({ host: null, lookNorthDeg: Number.NaN })).toBeNull();
  });
  const b = tower();
  const flat = (id: string, rot: number) => readFacing(sceneOf(id).property.layout, northInScene(b.north!, rot))!;
  it('the card says the door and the balcony in words', () => {
    expect(cardLines(flat('test-tower-flat-2bhk-b4', 270))).toEqual(['Main door faces west', 'Deck faces east']);
    const lines = facingLines(flat('test-tower-flat-3bhk-a', 180));
    expect(lines[0]).toEqual({ what: 'Main door', text: 'faces south', tag: 'S' });
    expect(lines[1].what).toBe('Balcony'); expect(lines[1].text).toMatch(/faces north/);
    expect(lines.length).toBe(1 + sceneOf('test-tower-flat-3bhk-a').property.layout.rooms.length);
  });
  it('a flat with no outside door says so rather than guessing', () => {
    const r = flat('test-tower-flat-2bhk-b4', 270);
    const none = { ...r, mainDoor: null };
    expect(facingLines(none)[0]).toMatchObject({ what: 'Main door', tag: null });
    expect(cardLines(none).some((l) => /Main door/.test(l))).toBe(false);
  });
  it('the letters sit on the edge of the plan where the compass says, whatever the turn', () => {
    const vb = { x: 0, y: 0, width: 20, height: 10 };
    const up = edgeMarks({ deg: 0, source: 'builder' }, vb, 1);
    expect(up.find((m) => m.dir === 'N')).toMatchObject({ x: 10, z: 1 });
    expect(up.find((m) => m.dir === 'S')).toMatchObject({ x: 10, z: 9 });
    expect(up.find((m) => m.dir === 'E')!.x).toBeCloseTo(19, 6);
    const down = edgeMarks({ deg: 180, source: 'builder' }, vb, 1);
    expect(down.find((m) => m.dir === 'N')!.z).toBeCloseTo(9, 6); // north is down the page
    const right = edgeMarks({ deg: 90, source: 'builder' }, vb, 1);
    expect(right.find((m) => m.dir === 'N')!.x).toBeCloseTo(19, 6); // north is the page's right
    for (const m of [...up, ...down, ...right]) { expect(m.x).toBeGreaterThanOrEqual(1 - 1e-9); expect(m.x).toBeLessThanOrEqual(19 + 1e-9); expect(m.z).toBeGreaterThanOrEqual(1 - 1e-9); expect(m.z).toBeLessThanOrEqual(9 + 1e-9); }
  });
  it('the dial turns with the camera and has no reading when it looks straight up or down', () => {
    expect(dialState({ deg: 0, source: 'builder' }, { x: 0, z: -1 })).toEqual({ bearing: 0, label: 'N' });
    expect(dialState({ deg: 0, source: 'builder' }, { x: 1, z: 0 })).toEqual({ bearing: 90, label: 'E' });
    expect(dialState({ deg: 180, source: 'builder' }, { x: 0, z: -1 })!.label).toBe('S');
    expect(dialState({ deg: 0, source: 'builder' }, { x: 0, z: 0 })).toBeNull();
    expect(zoneWord('C')).toBe('centre'); expect(zoneWord('NE')).toBe('north-east');
  });
});

describe('nothing shows without a north', () => {
  it('the walk mounts the aids only when a north was resolved, and the nav marks only with one', () => {
    const main = fs.readFileSync('src/buyer/main.ts', 'utf8');
    expect(main).toMatch(/if \(north && facing\) \{\s*\n\s*const dirs = mountDirections/);
    const nav = fs.readFileSync('src/buyer/nav/mount.ts', 'utf8');
    expect(nav).toMatch(/if \(d\.north\) \{/);
    expect(nav).toMatch(/if \(!d\.north\) return;/);
  });
  it('the checklist needs both a north (the mount) and the building\'s switch (setVastu), and starts off', () => {
    const mount = fs.readFileSync('src/buyer/directions/mount.ts', 'utf8');
    expect(mount).toMatch(/let vastuOn = false;/);
    expect(mount).toMatch(/vastuOn && d\.vastuAllowed/);
    const main = fs.readFileSync('src/buyer/main.ts', 'utf8');
    expect(main).toMatch(/params\.get\('vastu'\) === '1'/);
  });
  it('a flat without a north has no facing reading at all', async () => {
    const { readingFor } = await import('../src/buyer/directions/model');
    expect(readingFor(sceneOf('test-tower-flat-2bhk-b4').property.layout, null)).toBeNull();
    expect(byFloor([])).toEqual([]);
  });
});
