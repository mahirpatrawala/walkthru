// Owned by C11 look-kit. The fittings that make a flat read as an Indian home (SPEC 16.5 addendum "kit"): ceiling fans, tube lights,
// modular switchboards, window grills and mosquito-mesh frames, MS railings, vitrified floor tiles with grout, a cove ceiling in living
// rooms and master bedrooms, skirting. All of it is decor: it lives in its own group (not under the shell or the furniture root), cannot be
// hit by a ray, never feeds a measurement, a fit check or the collision grid, and is labelled "typical fittings, not from your drawing".
import * as THREE from 'three';
import type { FurnitureItem, Layout } from '../../types';
import type { Viewer } from '../../engine/viewer';
import type { Look } from '../look';
import { buildBuckets, newBuckets, addBoard } from './build';
import type { Acc } from './build';
import { createKitMaterials } from './materials';
import type { KitMaterials, LightKind } from './materials';
import { KIT_NOTE, bedheadBoards, kitPlan } from './rules';
import type { KitPlan } from './rules';

export { KIT_NOTE } from './rules';
export type { LightKind } from './materials';

export interface KitStore { all(): FurnitureItem[]; onChange(cb: () => void): () => void }
export interface KitOptions {
  viewer: Pick<Viewer, 'scene' | 'onFrame'>;
  layout: Layout;
  shell: THREE.Object3D;
  /** absent when the look could not start: then there are no tile grids (they need the look's shader) and the cove uses a plain material */
  look: Look | null;
  store?: KitStore;
  /** starts without the kit (also `?kit=off` in the URL) */
  plain?: boolean;
}
export interface KitHandle {
  readonly group: THREE.Group;
  readonly plan: KitPlan;
  readonly plain: boolean;
  setPlain(on: boolean): void;
  /** switch the lit parts of one kind on or off (all off by default). The meshes also carry `userData.walkthruLight`. */
  setLit(kind: LightKind, on: boolean): void;
  stats(): { meshes: number; triangles: number };
  dispose(): void;
}

const PLAIN_KEY = 'walkthru:kit-plain';
const read = (k: string): string | null => { try { return window.localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string): void => { try { window.localStorage.setItem(k, v); } catch { /* private window */ } };

/** Runs `fn` when `selector` exists: now, or as soon as the page adds it (the look panel and the rooms sheet are mounted by main). */
function whenFound(selector: string, fn: (el: HTMLElement) => void, timeoutMs = 15000): () => void {
  if (typeof document === 'undefined') return () => {};
  const now = document.querySelector<HTMLElement>(selector);
  if (now) { fn(now); return () => {}; }
  const mo = new MutationObserver(() => {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) { mo.disconnect(); clearTimeout(t); fn(el); }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  const t = setTimeout(() => mo.disconnect(), timeoutMs);
  return () => { mo.disconnect(); clearTimeout(t); };
}

export function mountKit(o: KitOptions): KitHandle {
  const { layout } = o;
  const furniture = o.store?.all() ?? [];
  const plan = kitPlan(layout, furniture);
  const built = buildBuckets(layout, plan);
  const mats: KitMaterials = createKitMaterials(layout.finishes, { wall: o.look ? (c) => o.look!.materials().wall(c) : null });

  const group = new THREE.Group();
  group.name = 'kit';
  group.userData.decor = true;
  const geos: THREE.BufferGeometry[] = [];
  let triangles = 0;

  const add = (name: string, acc: Acc, mat: THREE.Material, light?: LightKind): THREE.Mesh | null => {
    if (acc.empty) return null;
    const geo = acc.geometry();
    geos.push(geo);
    triangles += acc.triangles;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `kit:${name}`;
    mesh.userData.kit = true;
    if (light) mesh.userData.walkthruLight = light;
    mesh.raycast = () => {}; // never a measurement or a click target
    group.add(mesh);
    return mesh;
  };
  const b = built.buckets;
  add('skirting', b.skirting, mats.skirting);
  add('grill', b.grill, mats.grill);
  add('mesh-frame', b.meshFrame, mats.alu);
  const veil = add('mesh', b.meshVeil, mats.veil);
  if (veil) veil.renderOrder = 3;
  add('railing', b.railing, mats.railing);
  add('tube-body', b.tubeBody, mats.tubeBody);
  add('tube-lens', b.tubeLens, mats.lens.tube, 'tube');
  add('plates', b.plate, mats.plate);
  add('bezels', b.bezel, mats.bezel);
  add('rockers', b.rocker, mats.rocker);
  add('sockets', b.socket, mats.socket);
  add('fan', b.fanStatic, mats.fan);
  add('fan-light', b.fanLight, mats.lens.fan, 'fan');
  add('cove', b.cove, mats.cove);
  add('cove-led', b.coveLed, mats.lens.cove, 'cove');

  // the blades turn: one instanced mesh per blade radius
  const rotors: { mesh: THREE.InstancedMesh; sites: { x: number; z: number }[]; phase: number[] }[] = [];
  for (const r of built.rotors) {
    const mesh = new THREE.InstancedMesh(r.geometry, mats.fan, r.sites.length);
    mesh.name = 'kit:fan-blades';
    mesh.userData.kit = true;
    mesh.raycast = () => {};
    mesh.frustumCulled = false;
    geos.push(r.geometry);
    triangles += (r.geometry.attributes.position.count / 3) * r.sites.length;
    group.add(mesh);
    rotors.push({ mesh, sites: r.sites, phase: r.sites.map((_, i) => i * 1.9) });
  }
  const reduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const m4 = new THREE.Matrix4();
  let angle = 0;
  const spin = (): void => {
    for (const r of rotors) {
      r.sites.forEach((s, i) => {
        m4.makeRotationY(angle + r.phase[i]);
        m4.setPosition(s.x, 0, s.z);
        r.mesh.setMatrixAt(i, m4);
      });
      r.mesh.instanceMatrix.needsUpdate = true;
    }
  };
  spin();

  // bed-head boards follow the beds (a bed the buyer adds or moves, SPEC furnish)
  let bedGroup: THREE.Group | null = null;
  let bedKey = '';
  const walls = built.walls;
  const rebuildBedheads = (): void => {
    const items = o.store?.all() ?? furniture;
    const sites = bedheadBoards(layout, items);
    const key = sites.map((s) => `${s.roomId}:${s.edge}:${s.u.toFixed(2)}`).join('|');
    if (key === bedKey) return;
    bedKey = key;
    if (bedGroup) { group.remove(bedGroup); bedGroup.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); }); }
    bedGroup = new THREE.Group();
    bedGroup.name = 'kit:bedheads';
    const bk = newBuckets();
    for (const s of sites) addBoard(bk, walls, s);
    const parts: [Acc, THREE.Material, string][] = [[bk.plate, mats.plate, 'plates'], [bk.bezel, mats.bezel, 'bezels'], [bk.rocker, mats.rocker, 'rockers'], [bk.socket, mats.socket, 'sockets']];
    for (const [acc, mat, name] of parts) {
      if (acc.empty) continue;
      const mesh = new THREE.Mesh(acc.geometry(), mat);
      mesh.name = `kit:bedhead-${name}`;
      mesh.userData.kit = true;
      mesh.raycast = () => {};
      bedGroup.add(mesh);
    }
    group.add(bedGroup);
  };
  rebuildBedheads();
  let bedTimer: ReturnType<typeof setTimeout> | null = null;
  const offStore = o.store?.onChange(() => { if (bedTimer) clearTimeout(bedTimer); bedTimer = setTimeout(() => { bedTimer = null; rebuildBedheads(); }, 120); });

  o.viewer.scene.add(group);

  // ---- floors: each room gets its own tile grid. The shell's floor meshes keep their geometry (areas are unchanged); only the material swaps.
  const floorSwaps: { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; kit: THREE.Material }[] = [];
  if (o.look && plan.floors.length) {
    const lm = o.look.materials();
    const specs = new Map(plan.floors.map((f) => [f.roomId, f]));
    const rooms = new Map(layout.rooms.map((r) => [r.id, r]));
    o.shell.traverse((c) => {
      const mesh = c as THREE.Mesh;
      if (!mesh.isMesh || !(c.name.startsWith('floor:') || c.name.startsWith('threshold:'))) return;
      const id = c.userData.roomId as string | undefined;
      const spec = id ? specs.get(id) : undefined;
      const room = id ? rooms.get(id) : undefined;
      if (!spec || !room || room.partial) return;
      const mat = mesh.material as THREE.Material;
      if (Array.isArray(mat) || mat.userData.partialLook) return;
      const kit = lm.floorKit({
        color: room.floorColor ?? layout.finishes.floorColor, groutColor: layout.finishes.groutColor,
        tileU: spec.tileU, tileV: spec.tileV, axisX: spec.axisX, axisZ: spec.axisZ, originX: spec.originX, originZ: spec.originZ,
        groutM: spec.groutM, antiSkid: spec.antiSkid, matt: spec.matt,
      });
      floorSwaps.push({ mesh, original: mesh.material, kit });
    });
  }
  // the shell's solid railing is replaced by the MS one drawn inside the same footprint
  const solidRailing = plan.railings.length ? (o.shell.getObjectByName('railings') as THREE.Mesh | undefined) ?? null : null;

  // ---- on / off
  let plain = o.plain ?? (new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('kit') === 'off' || read(PLAIN_KEY) === '1');
  const shown = (): boolean => !plain && !(o.look?.trueColours ?? false) && !((o.look?.materials().shared.plain.value ?? 0) > 0.5);
  const listeners = new Set<() => void>();
  const apply = (): void => {
    const on = shown();
    group.visible = on;
    for (const s of floorSwaps) s.mesh.material = on ? s.kit : (s.original as THREE.Material);
    if (solidRailing) solidRailing.visible = !on;
    for (const cb of [...listeners]) cb();
  };
  apply();
  const offLook = o.look?.onChange(apply);

  const offFrame = o.viewer.onFrame((dt) => {
    if (!group.visible || reduce || rotors.length === 0) return;
    angle += dt * 1.5;
    spin();
  });

  // ---- the label and the Plain switch, in the look panel and the rooms sheet (injected: the panel and the sheet are not edited)
  const dom: (() => void)[] = [];
  const present = plan.fans.length + plan.tubes.length + plan.boards.length + plan.windows.length + plan.railings.length + plan.coves.length + plan.skirting.length + plan.floors.length > 0;
  if (present && typeof document !== 'undefined') {
    dom.push(whenFound('.wt-look-sheet', (sheet) => {
      const row = document.createElement('label');
      row.className = 'wt-look-switch';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('role', 'switch');
      input.dataset.testid = 'look-plain';
      input.checked = plain;
      const text = document.createElement('span');
      const bold = document.createElement('b');
      bold.textContent = 'Plain';
      const small = document.createElement('small');
      small.textContent = 'Hide the fan, lights, switches, grills and tiles, to judge the bare space.';
      text.append(bold, small);
      row.append(input, text);
      const tc = sheet.querySelector('[data-testid="look-true-colours"]')?.closest('label');
      if (tc) tc.after(row); else sheet.append(row);
      input.addEventListener('change', () => { handle.setPlain(input.checked); });
      listeners.add(() => { input.checked = plain; });
      const labels = sheet.querySelector('.wt-look-labels') ?? sheet;
      const p = document.createElement('p');
      p.dataset.testid = 'look-label-kit';
      p.textContent = KIT_NOTE;
      labels.append(p);
      dom.push(() => { row.remove(); p.remove(); });
    }));
    dom.push(whenFound('[data-testid="rooms-sheet"] .wt-rooms-card', (card) => {
      const p = document.createElement('p');
      p.className = 'wt-rooms-foot';
      p.dataset.testid = 'rooms-kit-note';
      p.textContent = KIT_NOTE;
      card.append(p);
      listeners.add(() => { p.hidden = !group.visible; });
      dom.push(() => p.remove());
    }));
  }

  const handle: KitHandle = {
    group, plan,
    get plain() { return plain; },
    setPlain(on) {
      plain = on;
      write(PLAIN_KEY, on ? '1' : '0');
      apply();
    },
    setLit(kind, on) { mats.setLit(kind, on); },
    stats: () => ({ meshes: group.children.length, triangles: Math.round(triangles) }),
    dispose() {
      offLook?.();
      offStore?.();
      offFrame();
      if (bedTimer) clearTimeout(bedTimer);
      for (const s of floorSwaps) s.mesh.material = s.original as THREE.Material;
      if (solidRailing) solidRailing.visible = true;
      for (const d of dom) d();
      o.viewer.scene.remove(group);
      for (const g of geos) g.dispose();
      bedGroup?.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); });
      for (const r of rotors) r.mesh.dispose();
      mats.dispose();
      listeners.clear();
    },
  };
  (globalThis as { __walkthruKit?: KitHandle }).__walkthruKit = handle;
  return handle;
}
