// Owned by C11 look-kit. The fittings that make a flat read as an Indian home (SPEC 16.5 addendum "kit"): ceiling fans, tube lights,
// modular switchboards, window grills and mosquito-mesh frames, MS railings, vitrified floor tiles with grout, a cove ceiling in living
// rooms and master bedrooms, skirting. All of it is decor: it lives in its own group (not under the shell or the furniture root), cannot be
// hit by a ray, never feeds a measurement, a fit check or the collision grid, and is labelled "typical fittings, not from your drawing".
import * as THREE from 'three';
import type { FurnitureItem, Layout } from '../../types';
import type { Viewer } from '../../engine/viewer';
import type { Look } from '../look';
import { addBoard, addFanStatic, addTube, buildBuckets, fanRotorGeometry, newBuckets } from './build';
import type { Acc, BucketName } from './build';
import { createKitMaterials } from './materials';
import type { KitMaterials, LightKind } from './materials';
import { KIT_NOTE, kitPlan } from './rules';
import type { KitPlan } from './rules';
import { kitFittings } from './fittings';
import type { KitFittings } from './fittings';
import type { FittingRecord, FittingRegistry, FittingsOverlay } from '../fittings';
import { PRISTINE_CHECKSUM_KEY, geometryChecksum } from '../baked/assign';

export { KIT_NOTE } from './rules';
export type { LightKind } from './materials';

export interface KitStore {
  all(): FurnitureItem[];
  onChange(cb: () => void): () => void;
  /** the home as drawn: the kit's fixtures are planned on it, so a viewer's edits never move a baked fixture */
  pristine?(): FurnitureItem[];
  /** the viewer's removed, moved and resized fittings */
  fittings?(): FittingsOverlay;
}
export interface KitOptions {
  viewer: Pick<Viewer, 'scene' | 'onFrame'>;
  layout: Layout;
  shell: THREE.Object3D;
  /** absent when the look could not start: then there are no tile grids (they need the look's shader) and the cove uses a plain material */
  look: Look | null;
  store?: KitStore;
  /** starts without the kit (also `?kit=off` in the URL) */
  plain?: boolean;
  /** where the fans, tubes and switchboards report themselves (tappable, movable) */
  registry?: FittingRegistry;
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
  const furniture = o.store?.pristine?.() ?? o.store?.all() ?? [];
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
  const fixturesMesh = add('fixtures', b.fixtures, mats.fixtures);
  const tubeLensMesh = add('tube-lens', b.tubeLens, mats.lens.tube, 'tube');
  const fanLightMesh = add('fan-light', b.fanLight, mats.lens.fan, 'fan');
  add('cove', b.cove, mats.cove);
  add('cove-led', b.coveLed, mats.lens.cove, 'cove');

  // the blades turn: one instanced mesh per blade radius (rebuilt when the viewer moves, resizes or removes a fan)
  let rotors: { mesh: THREE.InstancedMesh; sites: { x: number; z: number }[]; phase: number[] }[] = [];
  let rotorTris = 0;
  const rotorGeos: THREE.BufferGeometry[] = [];
  const buildRotors = (fans: { x: number; z: number; radiusM: number }[]): void => {
    for (const r of rotors) { group.remove(r.mesh); r.mesh.dispose(); }
    for (const g of rotorGeos.splice(0)) g.dispose();
    rotors = [];
    rotorTris = 0;
    const byR = new Map<number, { x: number; z: number }[]>();
    for (const f of fans) { const r = Math.round(f.radiusM / 0.05) * 0.05; byR.set(r, [...(byR.get(r) ?? []), { x: f.x, z: f.z }]); }
    for (const [radiusM, sites] of byR) {
      const geometry = fanRotorGeometry(layout.wallHeightM, radiusM);
      const mesh = new THREE.InstancedMesh(geometry, mats.fan, sites.length);
      mesh.name = 'kit:fan-blades';
      mesh.userData.kit = true;
      mesh.raycast = () => {};
      mesh.frustumCulled = false;
      rotorGeos.push(geometry);
      rotorTris += (geometry.attributes.position.count / 3) * sites.length;
      group.add(mesh);
      rotors.push({ mesh, sites, phase: sites.map((_, i) => i * 1.9) });
    }
  };
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

  // ---- the viewer's edits: a fitting moved, resized or removed leaves the baked static meshes (its triangles collapse in place, so the
  // bake still matches the drawn geometry) and, unless removed, is built again in the edited group, which the bake lights by probes.
  const staticMeshes: Partial<Record<BucketName, { mesh: THREE.Mesh; original: Float32Array }>> = {};
  const nameOf: Record<BucketName, THREE.Mesh | null> = { fixtures: fixturesMesh, tubeLens: tubeLensMesh, fanLight: fanLightMesh };
  for (const name of ['fixtures', 'tubeLens', 'fanLight'] as BucketName[]) {
    const mesh = nameOf[name];
    if (mesh) staticMeshes[name] = { mesh, original: new Float32Array((mesh.geometry.getAttribute('position') as THREE.BufferAttribute).array as Float32Array) };
  }
  let editedGroup: THREE.Group | null = null;
  let editedKey = '';
  const collapse = (ids: Set<string>): void => {
    for (const name of ['fixtures', 'tubeLens', 'fanLight'] as BucketName[]) {
      const rec = staticMeshes[name];
      if (!rec) continue;
      const geo = rec.mesh.geometry;
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      if (ids.size && geo.userData[PRISTINE_CHECKSUM_KEY] === undefined) {
        // the bake knows this mesh by the checksum of the DRAWN positions: keep it before the first collapse
        const cs = geometryChecksum(geo);
        geo.userData[PRISTINE_CHECKSUM_KEY] = cs;
      }
      const verts = rec.original.length / 3;
      // the source vertices go back to the drawn positions, then the collapsed ones to the first vertex of their fitting
      arr.set(rec.original.subarray(0, Math.min(rec.original.length, arr.length)));
      const moved = new Map<number, [number, number, number]>();
      for (const id of ids) {
        for (const r of built.ranges.get(id) ?? []) {
          if (r.bucket !== name) continue;
          const at: [number, number, number] = [rec.original[r.from * 3], rec.original[r.from * 3 + 1], rec.original[r.from * 3 + 2]];
          for (let v = r.from; v < r.to; v++) { arr[v * 3] = at[0]; arr[v * 3 + 1] = at[1]; arr[v * 3 + 2] = at[2]; moved.set(v, at); }
        }
      }
      // the bake may have split vertices (appended copies of a source vertex): a copy follows its source
      const src = geo.userData.wtRemapSrc as Uint32Array | undefined;
      if (src && pos.count > verts) {
        for (let j = 0; j < src.length && verts + j < pos.count; j++) {
          const s0 = src[j];
          const at: [number, number, number] = moved.get(s0) ?? [rec.original[s0 * 3], rec.original[s0 * 3 + 1], rec.original[s0 * 3 + 2]];
          arr[(verts + j) * 3] = at[0]; arr[(verts + j) * 3 + 1] = at[1]; arr[(verts + j) * 3 + 2] = at[2];
        }
      }
      pos.needsUpdate = true;
    }
  };
  const buildEdited = (fit: KitFittings): void => {
    if (editedGroup) { group.remove(editedGroup); editedGroup.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); }); editedGroup = null; }
    const { fans, tubes, boards } = fit.dynamic;
    if (!fans.length && !tubes.length && !boards.length) return;
    editedGroup = new THREE.Group();
    editedGroup.name = 'kit:edited';
    const bk = newBuckets();
    for (const s of tubes) addTube(bk, walls, s);
    for (const s of boards) addBoard(bk, walls, s);
    for (const s of fans) addFanStatic(bk, s);
    const put = (name: string, acc: Acc, mat: THREE.Material, light?: LightKind): void => {
      if (acc.empty) return;
      const mesh = new THREE.Mesh(acc.geometry(), mat);
      mesh.name = `kit:edited-${name}`;
      mesh.userData.kit = true;
      if (light) mesh.userData.walkthruLight = light;
      mesh.raycast = () => {};
      editedGroup!.add(mesh);
    };
    put('fixtures', bk.fixtures, mats.fixtures);
    put('tube-lens', bk.tubeLens, mats.lens.tube, 'tube');
    put('fan-light', bk.fanLight, mats.lens.fan, 'fan');
    group.add(editedGroup);
  };

  // bed-head boards follow the beds (a bed the buyer adds or moves, SPEC furnish)
  let bedGroup: THREE.Group | null = null;
  let bedKey = '';
  const walls = built.walls;
  let fit: KitFittings = kitFittings(layout, furniture, o.store?.all() ?? furniture, o.store?.fittings?.() ?? null);
  const rebuildBedheads = (): void => {
    const sites = fit.live.bedheads;
    const key = sites.map((s) => `${s.id}:${s.roomId}:${s.edge}:${s.u.toFixed(2)}:${s.y.toFixed(2)}`).join('|');
    if (key === bedKey) return;
    bedKey = key;
    if (bedGroup) { group.remove(bedGroup); bedGroup.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); }); }
    bedGroup = new THREE.Group();
    bedGroup.name = 'kit:bedheads';
    const bk = newBuckets();
    for (const s of sites) addBoard(bk, walls, s);
    if (!bk.fixtures.empty) {
      const mesh = new THREE.Mesh(bk.fixtures.geometry(), mats.fixtures);
      mesh.name = 'kit:bedhead-boards';
      mesh.userData.kit = true;
      mesh.raycast = () => {};
      bedGroup.add(mesh);
    }
    group.add(bedGroup);
  };
  let kitRecords: FittingRecord[] = [];
  // with the kit hidden (Plain, True colours) there is nothing to tap
  const publishRecords = (): void => { o.registry?.set('kit', group.visible ? kitRecords : []); };
  const refresh = (): void => {
    fit = kitFittings(layout, furniture, o.store?.all() ?? furniture, o.store?.fittings?.() ?? null);
    const key = JSON.stringify([[...fit.editedStatic].sort(), fit.live.fans.map((f) => [f.id, f.x, f.z, f.radiusM]), fit.dynamic.tubes.map((t) => [t.id, t.edge, t.u, t.y, t.lengthM]), fit.dynamic.boards.map((b) => [b.id, b.edge, b.u, b.y])]);
    if (key !== editedKey) {
      editedKey = key;
      collapse(fit.editedStatic);
      buildEdited(fit);
      buildRotors(fit.live.fans);
      spin();
    }
    rebuildBedheads();
    kitRecords = fit.records;
    publishRecords();
  };
  // the first build: the same as a refresh, but nothing is edited yet in the usual case, so the static meshes stay as built
  editedKey = '';
  refresh();
  let bedTimer: ReturnType<typeof setTimeout> | null = null;
  const offStore = o.store?.onChange(() => { if (bedTimer) clearTimeout(bedTimer); bedTimer = setTimeout(() => { bedTimer = null; refresh(); }, 120); });

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
  // (made invisible by a material that writes nothing, not by `visible`: the painterly mode skips invisible meshes and would lose the railing)
  const solidRailing = plan.railings.length ? (o.shell.getObjectByName('railings') as THREE.Mesh | undefined) ?? null : null;
  const solidOriginal = solidRailing?.material;
  const solidGhost = solidRailing ? new THREE.MeshBasicMaterial({ color: (solidOriginal as THREE.MeshStandardMaterial).color ?? '#3a3a3c', colorWrite: false, depthWrite: false }) : null;

  // ---- on / off
  let plain = o.plain ?? (new URLSearchParams(typeof location !== 'undefined' ? location.search : '').get('kit') === 'off' || read(PLAIN_KEY) === '1');
  const shown = (): boolean => !plain && !(o.look?.trueColours ?? false) && !((o.look?.materials().shared.plain.value ?? 0) > 0.5);
  const listeners = new Set<() => void>();
  const apply = (): void => {
    const on = shown();
    group.visible = on;
    for (const s of floorSwaps) s.mesh.material = on ? s.kit : (s.original as THREE.Material);
    if (solidRailing && solidGhost) solidRailing.material = on ? solidGhost : (solidOriginal as THREE.Material);
    publishRecords();
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
      p.style.marginTop = '6px';
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
    stats: () => ({ meshes: group.children.length, triangles: Math.round(triangles + rotorTris) }),
    dispose() {
      offLook?.();
      offStore?.();
      offFrame();
      if (bedTimer) clearTimeout(bedTimer);
      for (const s of floorSwaps) s.mesh.material = s.original as THREE.Material;
      if (solidRailing) solidRailing.material = solidOriginal as THREE.Material;
      solidGhost?.dispose();
      for (const d of dom) d();
      o.viewer.scene.remove(group);
      for (const g of geos) g.dispose();
      bedGroup?.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); });
      for (const r of rotors) r.mesh.dispose();
      for (const g of rotorGeos) g.dispose();
      editedGroup?.traverse((c) => { (c as THREE.Mesh).geometry?.dispose(); });
      mats.dispose();
      listeners.clear();
    },
  };
  (globalThis as { __walkthruKit?: KitHandle }).__walkthruKit = handle;
  return handle;
}
