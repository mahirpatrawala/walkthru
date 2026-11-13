// C12c. SPEC 17.7 "Reconciling sheets". What the elevations found is matched with what the plan has: a unit with the wardrobe on
// its wall, a window or door with the plan's opening, a bed's levels with the bed, the ceilings of all the views with each other.
// The same quantity seen twice is merged when the two agree (a `cross-sheet` check is recorded); when they disagree the item gets a
// conflict that names both and nothing is called a fact until the broker chooses. Pure TypeScript.
import type { Check, Extracted } from './types';
import type { ImportResult } from '../import/types';
import type { Analysis } from './text-dims';
import type { ElevationUnderstanding } from './elevations';
import { LINK_MIN } from './elevations';
import { featuresOnWall } from './elevation-link';
import type { ElevView, LinkResult } from './elevation-link';
import type { OpeningRead, UnitRead, ViewRead } from './elevation-read';

export interface UnitAttach { itemId: string; view: string; sheet: string; read: UnitRead }
export interface OpeningAttach { openingId: string; view: string; sill?: Extracted<number>; head?: Extracted<number>; width?: Extracted<number> }
export interface BedAttach { itemId: string; view: string; base?: Extracted<number>; mattress?: Extracted<number>; headboard?: Extracted<number> }
export interface ConflictOut { id: string; field: string; values: string[]; message: string }
export interface Reconciled {
  units: UnitAttach[]; openings: OpeningAttach[]; beds: BedAttach[];
  ceiling: { e: Extracted<number>; views: string[] } | null;
  conflicts: ConflictOut[];
}

const IN = 0.0254;
const fmtIn = (m: number): string => { const t = Math.round(m / IN); return `${Math.floor(t / 12)}'-${t % 12}"`; };
const hash = (s: string): string => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };

/**
 * Dimensions the page's models could not judge, checked against the linked wall's length as a ruler (elevation-read.evaluateDims):
 * the verdicts are put back on the analysis so every list of dimensions agrees with the readings made from them.
 */
export function applyDimUpgrades(analysis: Analysis, elev: ElevationUnderstanding, frame: { cx: number; cy: number } | null = null): void {
  for (const [viewId, evs] of elev.dimEvals) {
    const page = elev.views.find((v) => v.id === viewId)?.page;
    for (const [id, ev] of evs) {
      if (!ev.upgraded || page === undefined) continue;
      // dimension ids repeat from page to page: the page is part of the name
      const d = analysis.dims.find((x) => x.page === page && x.verdict.dim.id === id);
      if (!d) continue;
      d.status = ev.status; d.verdict.status = ev.status; d.verdict.checks = ev.checks; d.verdict.confidence = ev.confidence;
      if (ev.message) d.verdict.message = ev.message;
      // an elevation's metres are at the scale it was judged at
      if (frame && ev.ptPerM) { const w = (p: [number, number]): [number, number] => [(p[0] - frame.cx) / ev.ptPerM!, (p[1] - frame.cy) / ev.ptPerM!]; d.a = w(d.verdict.dim.a); d.b = w(d.verdict.dim.b); }
    }
  }
}

const frac = (v: ElevView, x0: number, x1: number, mirrored: boolean): [number, number] => {
  const st = v.st!; const W = st.right - st.left;
  const a = (x0 - st.left) / W, b = (x1 - st.left) / W;
  return mirrored ? [1 - b, 1 - a] : [a, b];
};
const iou = (a: [number, number], b: [number, number]): number => {
  const i = Math.max(0, Math.min(a[1], b[1]) - Math.max(a[0], b[0]));
  const u = Math.max(a[1], b[1]) - Math.min(a[0], b[0]);
  return u > 0 ? i / u : 0;
};

export function reconcile(result: ImportResult, elev: ElevationUnderstanding): Reconciled {
  const out: Reconciled = { units: [], openings: [], beds: [], ceiling: null, conflicts: [] };
  const ceilings: { e: Extracted<number>; view: string }[] = [];
  for (const v of elev.views) {
    const rd: ViewRead | undefined = elev.reads.find((r) => r.view === v.id);
    const link: LinkResult | undefined = elev.links.find((l) => l.view === v.id);
    if (!rd || !v.st || v.internal) continue;
    if (rd.ceiling) ceilings.push({ e: rd.ceiling, view: v.id });
    if (!link?.wall || link.confidence < LINK_MIN) continue;
    const wall = elev.walls.find((w) => w.roomId === link.wall!.roomId && w.edge === link.wall!.edge);
    if (!wall) continue;
    const feats = featuresOnWall(wall, result, elev.items);
    const mirrored = link.evidence.mirrored;
    const sheet = v.caption?.text ?? '';
    const planFrac = (f: { u0: number; u1: number }): [number, number] => [f.u0 / wall.length, f.u1 / wall.length];
    const bestFeature = (kind: string, box: [number, number], used: Set<string>): { id: string; f: { u0: number; u1: number } } | null => {
      let best: { id: string; f: { u0: number; u1: number }; s: number } | null = null;
      for (const f of feats) { if (f.kind !== kind || used.has(f.id)) continue; const s = iou(box, planFrac(f)); if (s > (best?.s ?? 0.35)) best = { id: f.id, f, s }; }
      return best;
    };
    const used = new Set<string>();
    for (const u of rd.units) {
      const m = bestFeature('unit', frac(v, u.box[0], u.box[2], mirrored), used);
      if (!m) continue;
      used.add(m.id);
      out.units.push({ itemId: m.id, view: v.id, sheet, read: u });
      // the same width seen on two sheets: the unit's overall against the plan's box
      const item = elev.items.find((i) => i.id === m.id);
      if (item && u.width && (u.width.status === 'verified' || u.width.status === 'confirmed')) {
        const d = Math.abs(item.box.w - u.width.value);
        if (d > 0.1) out.conflicts.push({ id: hash(`unitw.${m.id}.${v.id}`), field: `items.${m.id}.width`, values: [fmtIn(item.box.w), fmtIn(u.width.value)], message: `The plan has the wardrobe ${fmtIn(item.box.w)} wide, but the elevation shows ${fmtIn(u.width.value)}. Check it with the designer.` });
        else if (d <= 1.5 * IN) u.width.checks = [...u.width.checks, { kind: 'cross-sheet', expected: item.box.w, got: u.width.value, ok: true } as Check];
      }
    }
    const usedO = new Set<string>();
    rd.openings.forEach((o: OpeningRead) => {
      const m = bestFeature(o.type, frac(v, o.box[0], o.box[2], mirrored), usedO);
      if (!m) return;
      usedO.add(m.id);
      out.openings.push({ openingId: m.id, view: v.id, ...(o.sill ? { sill: o.sill } : {}), ...(o.head ? { head: o.head } : {}), ...(o.width ? { width: o.width } : {}) });
    });
    for (const b of rd.beds) {
      const m = bestFeature('bed', frac(v, b.box[0], b.box[2], mirrored), new Set());
      if (!m) continue;
      const by = (k: string): Extracted<number> | undefined => b.levels.find((l) => l.kind === k)?.e;
      out.beds.push({ itemId: m.id, view: v.id, base: by('bed-base'), mattress: by('mattress-top'), headboard: by('headboard-top') });
    }
  }

  // the ceiling: one quantity seen on every view
  const plausible = ceilings.filter((c) => c.e.value >= 2.0 && c.e.value <= 4.5);
  const verified = plausible.filter((c) => c.e.status === 'verified');
  if (verified.length) {
    const first = verified.reduce((a, b) => (b.e.confidence > a.e.confidence ? b : a));
    const disagree = verified.filter((c) => Math.abs(c.e.value - first.e.value) > 0.5 * IN);
    const agree = plausible.filter((c) => Math.abs(c.e.value - first.e.value) <= 0.5 * IN);
    if (disagree.length) {
      const e: Extracted<number> = { ...first.e, status: 'conflict', confidence: 0.3, alternatives: [...(first.e.alternatives ?? []), ...disagree.map((d) => ({ value: d.e.value, method: d.e.method, source: d.e.source }))] };
      out.ceiling = { e, views: verified.map((c) => c.view) };
      out.conflicts.push({ id: hash(`ceil.${first.view}`), field: 'ceiling', values: [fmtIn(first.e.value), fmtIn(disagree[0].e.value)], message: `The elevations give the ceiling as ${fmtIn(first.e.value)} and as ${fmtIn(disagree[0].e.value)}.` });
    } else {
      const checks: Check[] = agree.length > 1 ? [...first.e.checks, { kind: 'cross-sheet', expected: first.e.value, got: agree[agree.length - 1].e.value, ok: true }] : first.e.checks;
      out.ceiling = { e: { ...first.e, checks }, views: agree.map((c) => c.view) };
    }
  } else if (plausible.length) {
    // nothing printed that agrees with the geometry: the middle reading, left unverified for the broker
    const sorted = [...plausible].sort((a, b) => a.e.value - b.e.value);
    const pick = sorted[sorted.length >> 1];
    out.ceiling = { e: { ...pick.e, status: pick.e.status === 'conflict' ? 'conflict' : 'unverified' }, views: [pick.view] };
  }
  return out;
}
