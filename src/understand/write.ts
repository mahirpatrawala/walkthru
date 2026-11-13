// C12c. SPEC 17.6 `write.ts`: what the elevation stage and the plan symbols found, put into the understanding file and the machine
// outputs. `addElevationData` takes the file C12e's vector adapter built (rooms, openings, items from labels, dimensions) and adds:
//   - furniture the plan shows with no label (symbols) as items, so a unit read from an elevation has an item to belong to;
//   - the plan symbols themselves (fixtures and the rest are recorded, not turned into items);
//   - for each item an elevation matched: its `UnitDesign`, heights, bed levels and the elevation it came from;
//   - for each opening an elevation matched: sill and head;
//   - one entry per elevation view (its wall, ceiling and levels), and the ceiling the views agree on, with the sheet it was read from.
// `designs.json` is then written only from verified, confirmed and corrected values by review-apply's `designForItem`; nothing here
// puts an unverified value into a buyer-facing file. Pure TypeScript; the files themselves are written by server/store.ts.
import type { FurnitureItem } from '../types';
import type { ProposalExtras } from '../import/types';
import type { Extracted, Method, Status } from './types';
import { isFact } from './types';
import type { UnderstandingDoc } from './review-model';
import type { Understood } from './pipeline';
import { reconcile } from './reconcile';
import { LINK_MIN } from './elevations';
import { furnitureEntry } from './lexicon';
import type { BaseOutputs } from './review-apply';

export type ExFn = <T>(path: string, value: T, method: Method, status: Status, confidence: number, bbox: [number, number, number, number], extra?: Partial<Extracted<T>> & { text?: string; page?: number }) => Extracted<T>;

const SYMBOL_KEY: Record<string, string> = { bed: 'bed', sofa: 'sofa', dining: 'dining', wardrobe: 'wardrobe', desk: 'desk', 'side table': 'side table', counter: 'counter' };

/** The plan's furniture symbols that no label turned into an item become items (`source: 'real'`), sized from the symbol's box. */
export function itemsFromSymbols(u: Understood, extras: ProposalExtras): { added: FurnitureItem[]; idOf: Map<string, string> } {
  const out: FurnitureItem[] = [];
  const idOf = new Map<string, string>();
  const counts: Record<string, number> = {};
  for (const f of extras.furniture) { const m = /^(.*)-(\d+)$/.exec(f.id); if (m) counts[m[1]] = Math.max(counts[m[1]] ?? 0, Number(m[2])); }
  for (const s of u.plan.symbols) {
    if (!s.furniture) continue;
    const key = SYMBOL_KEY[s.cls]; const spec = key ? furnitureEntry(key) : undefined;
    if (!spec || !spec.kind || spec.heightM === undefined || spec.surfaceHeightM === undefined) continue;
    const kind = spec.kind as FurnitureItem['kind'];
    const twin = [...extras.furniture, ...out].find((i) => i.kind === kind && Math.hypot(i.box.cx - s.box.cx, i.box.cz - s.box.cz) < 0.6);
    if (twin) { idOf.set(s.id, twin.id); continue; }
    counts[kind] = (counts[kind] ?? 0) + 1;
    const item: FurnitureItem = { id: `${kind}-${counts[kind]}`, source: 'real', kind, label: '', box: s.box, heightM: spec.heightM, surfaceHeightM: spec.surfaceHeightM };
    out.push(item); idOf.set(s.id, item.id);
  }
  return { added: out, idOf };
}

/** Adds the plan symbols and the elevations' readings to the understanding file and the base outputs. Mutates both. */
export function addElevationData(u: Understood, doc: UnderstandingDoc, base: BaseOutputs, ex: ExFn, planPage: number): void {
  const extras = base.extras;
  const frame = u.trace.frame;
  const toPage = (x: number, z: number): [number, number] => (frame ? [x * frame.ptPerM + frame.cx, z * frame.ptPerM + frame.cy] : [0, 0]);
  const planView = `p${planPage}`;

  // ---- items the plan shows with no label
  const { added, idOf } = itemsFromSymbols(u, extras);
  const itemOf = (id: string): string => idOf.get(id) ?? id;
  for (const f of added) {
    extras.furniture.push(f);
    const c = [toPage(f.box.cx - f.box.w / 2, f.box.cz - f.box.d / 2), toPage(f.box.cx + f.box.w / 2, f.box.cz + f.box.d / 2)];
    const bbox: [number, number, number, number] = [c[0][0], c[0][1], c[1][0], c[1][1]];
    doc.items.push({
      id: f.id,
      kind: ex(`item.kind.${f.id}`, f.kind, 'vector', 'unverified', 0.4, bbox, { derivedFrom: { ids: [], how: 'its shape on the plan' } }),
      box: { cx: f.box.cx, cz: f.box.cz, w: ex(`item.w.${f.id}`, f.box.w, 'vector', 'unverified', 0.3, bbox, { unit: 'm' }), d: ex(`item.d.${f.id}`, f.box.d, 'vector', 'unverified', 0.3, bbox, { unit: 'm' }), yawDeg: f.box.yawDeg },
    });
  }

  // ---- the plan's symbols, recorded (fixtures have no look yet; furniture ones point at their item)
  const itemAt = (cx: number, cz: number, kindOf: string): string | undefined => extras.furniture.find((i) => Math.hypot(i.box.cx - cx, i.box.cz - cz) < 0.6 && (kindOf === i.kind || (kindOf === 'desk' && i.kind === 'counter') || (kindOf === 'side table' && i.kind === 'counter')))?.id;
  for (const s of u.plan.symbols) {
    const [a, b] = [toPage(s.bboxM[0], s.bboxM[1]), toPage(s.bboxM[2], s.bboxM[3])];
    const bbox: [number, number, number, number] = [a[0], a[1], b[0], b[1]];
    const kind = SYMBOL_KEY[s.cls] ? (furnitureEntry(SYMBOL_KEY[s.cls])?.kind ?? s.cls) : s.cls;
    const mapped = s.furniture ? itemAt(s.box.cx, s.box.cz, kind as string) : undefined;
    doc.symbols.push({ id: s.id, view: planView, class: ex(`symbol.${s.id}`, s.cls, 'vector', 'unverified', Math.min(0.5, s.confidence), bbox, { text: s.evidence }), bbox, ...(mapped ? { mappedTo: mapped } : {}) });
  }

  // ---- elevations
  const e = u.elev;
  if (!e.views.length) return;
  const rec = reconcile(u.result, e);
  doc.conflicts.push(...rec.conflicts);
  const byItem = new Map(doc.items.map((i) => [i.id, i]));
  for (const att of rec.units) {
    const it = byItem.get(itemOf(att.itemId));
    if (!it) continue;
    it.unit = att.read.design;
    it.elevationView = att.view;
    if (att.read.height) it.height = att.read.height;
  }
  // an internal view belongs to the elevation its caption names: its compartments go on that elevation's unit
  for (const v of e.views.filter((x) => x.internal && x.caption?.parentTag)) {
    const parent = e.views.find((p) => !p.internal && p.caption?.tag === v.caption!.parentTag);
    const rd = e.reads.find((r) => r.view === v.id);
    const att = parent ? rec.units.find((x) => x.view === parent.id) : undefined;
    const it = att ? byItem.get(itemOf(att.itemId)) : undefined;
    if (it?.unit && rd?.interior?.some((b) => b.zonesBottomUp.length)) it.unit = { ...it.unit, interior: rd.interior.map((b, i) => ({ bay: i, zonesBottomUp: b.zonesBottomUp })) };
  }
  for (const bd of rec.beds) {
    const it = byItem.get(itemOf(bd.itemId));
    if (!it) continue;
    it.elevationView = bd.view;
    if (bd.headboard) it.height = bd.headboard;
    if (bd.mattress) it.surfaceHeight = bd.mattress;
    if (bd.base) it.bedBase = bd.base;
  }
  for (const oa of rec.openings) {
    const o = doc.openings.find((x) => x.id === oa.openingId);
    if (!o) continue;
    if (oa.sill) o.sill = oa.sill;
    if (oa.head) o.head = oa.head;
  }
  doc.elevations = e.views.map((v) => {
    const link = e.links.find((l) => l.view === v.id);
    const rd = e.reads.find((r) => r.view === v.id);
    const bbox = v.box;
    const wall = link?.wall && link.confidence >= LINK_MIN
      ? ex(`elev.wall.${v.id}`, { roomId: link.wall.roomId, edge: link.wall.edge }, 'derived', link.confidence >= 0.8 ? 'verified' : 'unverified', link.confidence, bbox, { page: v.page + 1, text: v.caption?.text, derivedFrom: { ids: [], how: link.evidence.key >= 3 ? 'the key on the plan' : 'the wall\'s length and what stands along it' } })
      : undefined;
    return { view: v.id, ...(wall ? { wall } : {}), ...(rd?.ceiling ? { ceiling: rd.ceiling } : {}), levels: (rd?.levels ?? []).filter((l) => l.kind !== 'ceiling').map((l) => l.e) };
  });
  for (const v of e.views) {
    const k = doc.views.find((x) => x.id === `p${v.page + 1}`);
    if (k && k.kind === 'other' && v.caption) k.kind = v.internal ? 'detail' : 'elevation';
  }

  // ---- the ceiling: the elevation's, when it has one; the importer's guess stays only when no elevation said anything
  if (rec.ceiling) {
    const c = rec.ceiling.e;
    const importer = extras.ceiling;
    if (importer.method !== 'text' || isFact(c.status)) {
      doc.ceiling = c;
      base.proposal.wallHeightM = c.value;
      extras.ceiling = { heightM: c.value, method: isFact(c.status) || c.method === 'pdf-text' || c.method === 'glyph' ? 'text' : 'geometry', page: c.source.page - 1, candidatesM: [...new Set(rec.ceiling.views.map(() => c.value))], confidence: isFact(c.status) ? 0.97 : 0.4 };
    }
  }
  base.extras.warnings.push(...e.warnings);
}
