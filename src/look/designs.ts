// Owned by C11b. Per-scene furniture designs read from a drawing (public/scenes/<id>/designs.json), so a finish detail is
// never a number hard-coded in the engine and every value carries its source. Missing file = generic 16.6 looks.
//
// What a design may change: an item's `heightM` and `surfaceHeightM` (the drawing wins over the catalogue default), finish
// parameters of the real look (bays of a wardrobe, a bed's base height), and decorative objects tied to an item. It never
// changes a box: the layout's footprint is what the fit checks use.
import * as THREE from 'three';
import type { FurnitureItem } from '../types';
import type { Tier } from './types';
import { STUDY_CHAIR, buildStudyChair, setItemDesigns } from './furniture-real';
import type { BedDesign, ItemDesign, WardrobeDesign } from './furniture-real';

export interface DesignSource { page: number; sheet: string; text: string }
export interface ItemDesignFile {
  heightM?: number;
  surfaceHeightM?: number;
  wardrobe?: WardrobeDesign;
  bed?: BedDesign;
  /** where each value came from; free text keys such as "heightM", "bays", "baseTopM" */
  sources?: Record<string, DesignSource | DesignSource[] | string>;
}
export interface DecorDesign {
  id: string;
  look: 'chair';
  /** the item this sits at (a counter), placed in that item's own frame */
  tiedTo: string;
  /** metres from the item's centre: x along its width (+ right), z out of its front */
  offset: { x: number; z: number };
  /** the chair faces the item */
  faceItem: boolean;
  sources?: Record<string, DesignSource | DesignSource[] | string>;
}
export interface DesignsFile {
  version: 1;
  source: string;
  items: Record<string, ItemDesignFile>;
  decor?: DecorDesign[];
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function parseDesigns(json: unknown): DesignsFile | null {
  if (!json || typeof json !== 'object') return null;
  const o = json as Record<string, unknown>;
  if (o.version !== 1 || !o.items || typeof o.items !== 'object') return null;
  const items: Record<string, ItemDesignFile> = {};
  for (const [id, raw] of Object.entries(o.items as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as ItemDesignFile;
    const it: ItemDesignFile = {};
    if (isNum(r.heightM) && r.heightM > 0.2 && r.heightM < 4) it.heightM = r.heightM;
    if (isNum(r.surfaceHeightM) && r.surfaceHeightM > 0.1 && r.surfaceHeightM < 4) it.surfaceHeightM = r.surfaceHeightM;
    const w = r.wardrobe;
    if (w && isNum(w.bays) && isNum(w.shuttersPerBay) && isNum(w.drawerStripM) && isNum(w.baseGapM) && isNum(w.handleYM) && isNum(w.handleLenM)
      && typeof w.frontColor === 'string' && typeof w.handleColor === 'string' && w.bays >= 1 && w.shuttersPerBay >= 1) it.wardrobe = { ...w };
    if (r.bed && isNum(r.bed.baseTopM) && r.bed.baseTopM > 0.1 && r.bed.baseTopM < 0.6) it.bed = { baseTopM: r.bed.baseTopM };
    if (r.sources) it.sources = r.sources;
    items[id] = it;
  }
  const decor: DecorDesign[] = [];
  if (Array.isArray(o.decor)) {
    for (const raw of o.decor as DecorDesign[]) {
      if (raw && raw.look === 'chair' && typeof raw.id === 'string' && typeof raw.tiedTo === 'string' && raw.offset && isNum(raw.offset.x) && isNum(raw.offset.z)) {
        decor.push({ id: raw.id, look: 'chair', tiedTo: raw.tiedTo, offset: { x: raw.offset.x, z: raw.offset.z }, faceItem: raw.faceItem !== false, sources: raw.sources });
      }
    }
  }
  return { version: 1, source: typeof o.source === 'string' ? o.source : '', items, decor };
}

/** Reads the optional designs.json of a scene. Missing, HTML (a dev server's index page) or broken: null. */
export async function fetchDesigns(sceneId: string): Promise<DesignsFile | null> {
  try {
    const res = await fetch(`/scenes/${sceneId}/designs.json`, { cache: 'no-cache' });
    if (!res.ok) return null;
    const text = await res.text();
    if (/^\s*</.test(text)) return null;
    return parseDesigns(JSON.parse(text));
  } catch {
    return null;
  }
}

/** The items with the drawn heights applied (boxes untouched). Registers the finish parameters for the real look. */
export function applyDesigns(items: FurnitureItem[], d: DesignsFile | null): FurnitureItem[] {
  const reg = new Map<string, ItemDesign>();
  if (!d) { setItemDesigns(null); return items; }
  const out = items.map((it) => {
    const dd = d.items[it.id];
    if (!dd) return it;
    const next: FurnitureItem = { ...it, box: { ...it.box } };
    if (it.inner) next.inner = { ...it.inner };
    if (dd.heightM !== undefined) next.heightM = dd.heightM;
    if (dd.surfaceHeightM !== undefined) next.surfaceHeightM = dd.surfaceHeightM;
    if (dd.wardrobe || dd.bed) reg.set(it.id, { wardrobe: dd.wardrobe, bed: dd.bed });
    return next;
  });
  setItemDesigns(reg);
  return out;
}

export interface Decor {
  id: string;
  group: THREE.Group;
  /** rebuild for another tier, in place */
  rebuild(tier: Tier): void;
  dispose(): void;
}

function disposeChildren(g: THREE.Group): void {
  for (const c of [...g.children]) {
    g.remove(c);
    c.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    });
  }
}

/** Builds the decorative objects (the study chair) at their items. Items that are missing from the scene are skipped. */
export function buildDecor(d: DesignsFile | null, items: FurnitureItem[], tier: Tier): Decor[] {
  if (!d?.decor) return [];
  const out: Decor[] = [];
  for (const spec of d.decor) {
    const host = items.find((i) => i.id === spec.tiedTo);
    if (!host) continue;
    const root = new THREE.Group();
    root.name = `decor:${spec.id}`;
    const yaw = (host.box.yawDeg * Math.PI) / 180;
    // item frame -> world: x right, z front; rotation.y = yaw maps local +Z to (sin yaw, cos yaw)
    const lx = spec.offset.x, lz = host.box.d / 2 + spec.offset.z;
    root.position.set(host.box.cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), 0, host.box.cz - lx * Math.sin(yaw) + lz * Math.cos(yaw));
    root.rotation.y = yaw + (spec.faceItem ? Math.PI : 0);
    const fill = (t: Tier): void => { disposeChildren(root); const g = buildStudyChair(t); for (const c of [...g.children]) root.add(c); };
    fill(tier);
    root.userData.decor = true;
    root.updateMatrixWorld(true);
    out.push({ id: spec.id, group: root, rebuild: fill, dispose: () => { disposeChildren(root); root.removeFromParent(); } });
  }
  return out;
}

export { STUDY_CHAIR };
