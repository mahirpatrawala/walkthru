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
/** One compartment of the wardrobe's inside, bottom to top (page 4 of the drawing). */
export interface OpenableZone {
  kind: 'footwear-drawer' | 'glass-drawer' | 'lockable-drawer' | 'open-shelf' | 'hanging' | 'folded-shirts' | 'board' | 'gap';
  heightM: number;
  /** the drawing's dimension string, or how a derived value was got */
  dim: string;
  label: string;
  /** not a dimension string on the drawing: measured or got by subtraction */
  derived?: boolean;
  note?: string;
}
/**
 * What the drawing says about opening a wardrobe (buyer: "Open wardrobe", SPEC 16.6 addendum). Every number has its page and
 * dimension string in `sources`; what the drawing does not give is listed in `notInDrawing` and shown to the buyer as such.
 */
export interface OpenableDesign {
  /** one bay's dimension on the elevation (a pair of shutters) */
  bayPitchM: number;
  /** one shutter's width: bayPitchM / 2 */
  shutterWidthM: number;
  /** each bay's centre, from the left end seen from the room, along the box width */
  bayCentresFromLeftM: number[];
  /** furthest a shutter sticks out is at this angle (the clearance does not depend on it) */
  maxAngleDeg: number;
  /** dimensioned gaps from the wardrobe front to another item, so the card can show its arithmetic */
  gaps: { toItem: string; label: string; gapM: number; text: string; page: number; sheet: string }[];
  conflicts: string[];
  /** one sentence of the main conflict for the card (the full text is in `conflicts`) */
  cardConflict?: string;
  notInDrawing: string[];
  interior?: {
    sidePanelM: number; partitionM: number; bayClearM: number;
    /** per bay, bottom to top, starting above the base gap */
    zonesBottomUp: OpenableZone[][];
    topCutNote?: string;
  };
  sources?: Record<string, DesignSource | DesignSource[] | string>;
}
export interface ItemDesignFile {
  heightM?: number;
  surfaceHeightM?: number;
  wardrobe?: WardrobeDesign;
  openable?: OpenableDesign;
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

const ZONE_KINDS = ['footwear-drawer', 'glass-drawer', 'lockable-drawer', 'open-shelf', 'hanging', 'folded-shirts', 'board', 'gap'];
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** The openable part of an item's design, or undefined when it is missing or malformed (the wardrobe then does not open). */
export function parseOpenable(raw: unknown): OpenableDesign | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  if (!isNum(o.bayPitchM) || !(o.bayPitchM > 0) || !isNum(o.shutterWidthM) || !(o.shutterWidthM > 0)) return undefined;
  if (!Array.isArray(o.bayCentresFromLeftM) || o.bayCentresFromLeftM.length < 1 || !o.bayCentresFromLeftM.every(isNum)) return undefined;
  const gaps: OpenableDesign['gaps'] = [];
  if (Array.isArray(o.gaps)) {
    for (const g of o.gaps as Record<string, unknown>[]) {
      if (g && typeof g.toItem === 'string' && isNum(g.gapM) && typeof g.text === 'string' && isNum(g.page)) {
        gaps.push({ toItem: g.toItem, label: typeof g.label === 'string' ? g.label : g.toItem, gapM: g.gapM, text: g.text, page: g.page, sheet: typeof g.sheet === 'string' ? g.sheet : '' });
      }
    }
  }
  const out: OpenableDesign = {
    bayPitchM: o.bayPitchM, shutterWidthM: o.shutterWidthM, bayCentresFromLeftM: [...(o.bayCentresFromLeftM as number[])],
    maxAngleDeg: isNum(o.maxAngleDeg) && o.maxAngleDeg > 0 && o.maxAngleDeg <= 180 ? o.maxAngleDeg : 90,
    gaps, conflicts: strs(o.conflicts), notInDrawing: strs(o.notInDrawing),
  };
  if (typeof o.cardConflict === 'string') out.cardConflict = o.cardConflict;
  const inn = o.interior as Record<string, unknown> | undefined;
  if (inn && isNum(inn.sidePanelM) && isNum(inn.partitionM) && isNum(inn.bayClearM) && Array.isArray(inn.zonesBottomUp)) {
    const zones: OpenableZone[][] = [];
    for (const bay of inn.zonesBottomUp as unknown[]) {
      const list: OpenableZone[] = [];
      for (const z of Array.isArray(bay) ? (bay as Record<string, unknown>[]) : []) {
        if (z && typeof z.kind === 'string' && ZONE_KINDS.includes(z.kind) && isNum(z.heightM) && z.heightM > 0) {
          list.push({
            kind: z.kind as OpenableZone['kind'], heightM: z.heightM, dim: typeof z.dim === 'string' ? z.dim : '',
            label: typeof z.label === 'string' ? z.label : z.kind, ...(z.derived ? { derived: true } : {}), ...(typeof z.note === 'string' ? { note: z.note } : {}),
          });
        }
      }
      zones.push(list);
    }
    out.interior = { sidePanelM: inn.sidePanelM, partitionM: inn.partitionM, bayClearM: inn.bayClearM, zonesBottomUp: zones, ...(typeof inn.topCutNote === 'string' ? { topCutNote: inn.topCutNote } : {}) };
  }
  if (o.sources && typeof o.sources === 'object') out.sources = o.sources as OpenableDesign['sources'];
  return out;
}

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
    const op = parseOpenable(r.openable);
    if (op) it.openable = op;
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
