// C12d. SPEC 17.6 outputs for the raster path: understanding.json's fields, and C8's proposal.json / proposal-extras.json
// shapes, plus designs.json (written only from verified, confirmed or corrected values: a picture gives none, so it is empty
// and says so). Everything a model read stays `unverified` unless raster.ts's checks promoted it.
import { createHash } from 'node:crypto';
import type { FurnitureItem, LayoutProposal, Opening, RoomTag, Vec2 } from '../../types';
import { polygonArea } from '../../core/geometry';
import { defaultEdges } from '../../core/layout-geom';
import { normalizeRoom, validateLayout, createEmptyProperty } from '../../core/layout-validate';
import type { ImportResult, ProposalExtras, RoomFinding } from '../../import/types';
import { chooseSpawn } from '../../import/propose';
import type { DesignsFile } from '../../look/designs';
import { furnitureEntry, roomTypeOf } from '../lexicon';
import { parseLengthLoose } from '../units';
import type { Extracted, Method, Status } from '../types';
import type { PlanRead } from '../vision/provider';
import type { ScaleFit } from './fit';
import { scaleFor } from './fit';
import type { Pt, Rect } from './image';
import type { RasterUnderstanding } from './types';
import type { DimWork, Frame, RoomWork } from './work';

export interface BuildIn {
  u: RasterUnderstanding;
  plane: { pageId: string; frame: Frame; imgToSentScale: number };
  scale: ScaleFit; fit: ScaleFit | null; gated: boolean; fallback: boolean;
  rooms: RoomWork[]; dims: DimWork[]; read: PlanRead;
  rectToImg: (b: [number, number, number, number]) => Rect;
  hints: { conf: { one: number; two: number; verified: number; geometry: number } };
  /** crop origin in image pixels (unused by the maths; kept for the log) */
  origin: Pt;
}
const FURNITURE_CLASSES = new Set(['bed', 'sofa', 'dining', 'wardrobe', 'desk', 'side table', 'tv unit', 'counter']);
const FIXTURE_CLASSES = new Set(['chair', 'wc', 'basin', 'shower', 'sink', 'hob']);
/** What a room is, from the classes drawn in it. Ordinary planning vocabulary: sanitary fixtures first, then the cooker, the bed, the seating. */
const typeFromContents = (classes: string[]): RoomTag['roomType'] | null => {
  const has = (...c: string[]): boolean => classes.some((x) => c.includes(x));
  if (has('wc', 'shower')) return 'bathroom';
  if (has('hob')) return 'kitchen';
  if (has('bed')) return 'bedroom';
  if (has('sofa', 'dining')) return 'living';
  return null;
};
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const hash = (s: string): string => createHash('sha1').update(s).digest('hex').slice(0, 10);

export function buildOutputs(b: BuildIn): { result: ImportResult; designs: DesignsFile } {
  const { u, plane, scale, rooms, dims, read, hints } = b;
  const C = hints.conf;
  const pageNo = u.views.findIndex((v) => v.id === plane.pageId) + 1 || 1;
  const sx = scaleFor(scale, 'x'), sy = scaleFor(scale, 'y');
  // metre frame: x right, z down, origin at the top-left of the rooms
  const ox = Math.min(...rooms.flatMap((r) => r.poly.map((p) => p[0]))), oy = Math.min(...rooms.flatMap((r) => r.poly.map((p) => p[1])));
  const toM = (p: Pt): Pt => [(p[0] - ox) / sx, (p[1] - oy) / sy];
  const src = (r: Rect, text?: string): Extracted<number>['source'] => { const pr = plane.frame.rectToPage(r); return { page: pageNo, view: plane.pageId, sheet: '', bbox: [pr[0], pr[1], pr[2], pr[3]], ...(text ? { text } : {}) }; };
  const ex = <T,>(path: string, value: T, method: Method, status: Status, confidence: number, r: Rect, extra: Partial<Extracted<T>> & { text?: string } = {}): Extracted<T> => {
    const { text, ...rest } = extra;
    return { id: hash(`${path}|${r.map((x) => Math.round(x)).join(',')}`), value, method, status, confidence, source: src(r, text), checks: [], ...rest };
  };
  const trusted = !b.gated && !b.fallback;

  // ---- scale
  const view = u.views.find((v) => v.id === plane.pageId);
  if (view) {
    const rr: Rect = [0, 0, 1, 1];
    view.scale = ex('scale', sx, 'derived', 'unverified', b.fit?.ok && trusted ? 0.6 : 0.2, rr, { unit: undefined, derivedFrom: { ids: [], how: `pixels per metre, fitted from ${b.fit?.inliers ?? 0} of ${b.fit?.total ?? 0} printed sizes${b.fallback ? ', guessed from door widths' : ''}${b.fit?.mode === 'axis' ? `; stretched drawing, ${sx.toFixed(1)} across and ${sy.toFixed(1)} down` : ''}` } });
  }

  // ---- rooms
  const tags: RoomTag[] = []; const findings: RoomFinding[] = [];
  const verifiedRoom = new Map<string, boolean>();
  const roomOut: RasterUnderstanding['rooms'] = [];
  for (const r of rooms) {
    const ptsM = r.poly.map(toM);
    const wM = (r.bboxPx[2] - r.bboxPx[0]) / sx, lM = (r.bboxPx[3] - r.bboxPx[1]) / sy;
    const rect = r.bboxPx;
    const fact = r.status === 'verified' && trusted;
    const status: Status = fact ? 'verified' : r.status === 'conflict' ? 'conflict' : 'unverified';
    const withText = !!r.size;
    const conf = fact ? C.verified : r.status === 'conflict' ? C.two : withText ? (r.agreeTwo ? C.two : C.one) : C.geometry;
    const nameConf = r.nameVia === 'none' ? 0 : r.agreeTwo ? C.two : C.one;
    const labelEx = ex(`room.label.${r.id}`, r.name, 'vision', 'unverified', nameConf, rect, { checks: [] });
    // no label: what is drawn inside the room says what it is (a bed, a hob, a wc)
    const inside = read.symbols.filter((sy) => { const bi = b.rectToImg(sy.box); const cx = (bi[0] + bi[2]) / 2, cy = (bi[1] + bi[3]) / 2; return cx > rect[0] && cx < rect[2] && cy > rect[1] && cy < rect[3]; }).map((sy) => sy.cls);
    const byContent = r.nameVia === 'none' || !r.name ? typeFromContents(inside) : null;
    const rtype = byContent ?? roomTypeOf(r.name);
    const typeEx = ex(`room.type.${r.id}`, rtype, 'derived', 'unverified', byContent ? C.geometry : nameConf, rect, { derivedFrom: { ids: [labelEx.id], how: byContent ? `what is drawn in the room: ${inside.join(', ')}` : 'room words in the label' } });
    const size = (suffix: string, v: number): Extracted<number> => ex(`room.${suffix}.${r.id}`, v, withText ? 'vision' : 'derived', status, conf, rect, { unit: suffix === 'area' ? 'm2' : 'm', checks: r.checks, ...(r.sizeText ? { text: r.sizeText } : {}), ...(withText ? {} : { derivedFrom: { ids: [], how: 'pixel length of the wall-to-wall box divided by the fitted scale' } }) });
    const [w2, l2] = wM <= lM ? [wM, lM] : [lM, wM];
    roomOut.push({ id: r.id, label: labelEx, roomType: typeEx, polygonM: ptsM, width: size('width', w2), length: size('length', l2), area: size('area', wM * lM) });
    verifiedRoom.set(r.id, fact);
    if (r.status === 'conflict') u.conflicts.push({ id: hash(`conflict.${r.id}`), field: `rooms.${r.id}.size`, values: [r.sizeText ?? '', `${wM.toFixed(2)} x ${lM.toFixed(2)} m`], message: r.conflictNote ?? 'label and drawing disagree' });
    let poly: Vec2[] = ptsM.map(([x, z]) => ({ x, z }));
    if (polygonArea(poly) < 0) poly = poly.reverse();
    let s0 = 0; poly.forEach((p, i) => { const q = poly[s0]; if (p.z < q.z - 1e-6 || (Math.abs(p.z - q.z) <= 1e-6 && p.x < q.x)) s0 = i; });
    poly = [...poly.slice(s0), ...poly.slice(0, s0)];
    const label = r.name || `Room ${tags.length + 1}`;
    let id = slug(label) || r.id; while (tags.some((t) => t.id === id)) id += 'x';
    tags.push({ id, roomType: rtype, label, polygon: poly, edges: poly.map(() => 'wall' as const) });
    findings.push({ id, label, roomType: rtype, method: 'walls', confidence: conf, areaM2: wM * lM, ...(r.size ? { labelDims: { w: r.size.w, l: r.size.l } } : {}) });
    (findings[findings.length - 1] as RoomFinding & { verified: boolean; note?: string }).verified = fact;
    if (!fact) (findings[findings.length - 1] as RoomFinding & { note?: string }).note = 'read from a picture, not checked';
    roomOut[roomOut.length - 1].id = id;
    verifiedRoom.set(id, fact);
  }
  u.rooms = roomOut;
  const finalRooms = tags.map((t) => normalizeRoom({ ...t, edges: defaultEdges(t, tags) }));

  // ---- openings: put each on the nearest wall edge of a room
  const openings: Opening[] = [];
  const ointo: RasterUnderstanding['openings'] = [];
  const ids = new Set<string>();
  read.openings.forEach((o, i) => {
    const bi = b.rectToImg(o.box);
    const c = toM([(bi[0] + bi[2]) / 2, (bi[1] + bi[3]) / 2]);
    const widthM = Math.max((bi[2] - bi[0]) / sx, (bi[3] - bi[1]) / sy);
    let best: { room: RoomTag; edge: number; d: number; t: number } | null = null;
    for (const room of finalRooms) {
      const n = room.polygon.length;
      for (let e = 0; e < n; e++) {
        const p = room.polygon[e], q = room.polygon[(e + 1) % n];
        const dx = q.x - p.x, dz = q.z - p.z, L = Math.hypot(dx, dz) || 1;
        const t = ((c[0] - p.x) * dx + (c[1] - p.z) * dz) / L;
        if (t < -0.2 || t > L + 0.2) continue;
        const tt = Math.max(0, Math.min(L, t));
        const d = Math.hypot(c[0] - (p.x + (dx / L) * tt), c[1] - (p.z + (dz / L) * tt));
        if (!best || d < best.d) best = { room, edge: e, d, t: tt };
      }
    }
    if (!best || best.d > 1.2) return;
    let oid = `${o.kind}-${i + 1}`; while (ids.has(oid)) oid += 'x'; ids.add(oid);
    const head = o.kind === 'window' ? 2.1 : 2.1, sill = o.kind === 'window' ? 0.9 : 0;
    const wd = Math.max(0.3, Math.min(widthM, Math.hypot(best.room.polygon[(best.edge + 1) % best.room.polygon.length].x - best.room.polygon[best.edge].x, best.room.polygon[(best.edge + 1) % best.room.polygon.length].z - best.room.polygon[best.edge].z)));
    openings.push({ id: oid, roomId: best.room.id, edge: best.edge, type: o.kind, centreM: best.t, widthM: wd, sillM: sill, headM: head });
    ointo.push({ id: oid, roomId: best.room.id, type: ex(`opening.type.${oid}`, o.kind, 'vision', 'unverified', C.one, bi), width: ex(`opening.width.${oid}`, wd, 'derived', 'unverified', C.geometry, bi, { unit: 'm', derivedFrom: { ids: [], how: 'width of the drawn opening divided by the fitted scale' } }) });
  });
  u.openings = ointo;

  // ---- furniture and fixtures
  const items: FurnitureItem[] = []; const unmapped: ProposalExtras['unmapped'] = [];
  const itemOut: RasterUnderstanding['items'] = []; const symOut: RasterUnderstanding['symbols'] = [];
  read.symbols.forEach((s, i) => {
    const bi = b.rectToImg(s.box);
    const cm = toM([(bi[0] + bi[2]) / 2, (bi[1] + bi[3]) / 2]);
    const w = (bi[2] - bi[0]) / sx, d = (bi[3] - bi[1]) / sy;
    const clsEx = ex(`symbol.class.${i}`, s.cls, 'vision', 'unverified', C.one, bi);
    if (FURNITURE_CLASSES.has(s.cls)) {
      const iid = `${slug(s.cls)}-${itemOut.length + 1}`;
      itemOut.push({ id: iid, kind: clsEx, ...(s.label ? { label: ex(`symbol.label.${i}`, s.label, 'vision', 'unverified', C.one, bi) } : {}), box: { cx: cm[0], cz: cm[1], w: ex(`item.w.${iid}`, w, 'derived', 'unverified', C.geometry, bi, { unit: 'm' }), d: ex(`item.d.${iid}`, d, 'derived', 'unverified', C.geometry, bi, { unit: 'm' }), yawDeg: 0 } });
      const entry = furnitureEntry(s.cls);
      if (entry?.kind) items.push({ id: iid, source: 'real', kind: entry.kind as FurnitureItem['kind'], label: s.label || entry.displayName || s.cls, box: { cx: cm[0], cz: cm[1], w, d, yawDeg: 0 }, heightM: entry.heightM ?? 0.8, surfaceHeightM: entry.surfaceHeightM ?? 0.45 });
      else unmapped.push({ label: s.label || s.cls, sizeM: { w, l: d }, at: { x: cm[0], z: cm[1] }, reason: 'the catalogue has no slot for this yet' });
    } else if (FIXTURE_CLASSES.has(s.cls)) {
      symOut.push({ id: `sym-${symOut.length + 1}`, view: plane.pageId, class: clsEx, bbox: [bi[0], bi[1], bi[2], bi[3]], centreM: cm });
    }
  });
  u.items = itemOut; u.symbols = symOut;

  // ---- dimensions
  for (const d of dims) {
    if (!d.chosen || d.m === undefined) continue;
    const a = d.line ? toM(d.line[0]) : toM([(d.box[0] + d.box[2]) / 2, (d.box[1] + d.box[3]) / 2]);
    const bb = d.line ? toM(d.line[1]) : a;
    const status: Status = d.status === 'verified' && trusted ? 'verified' : d.status === 'conflict' ? 'conflict' : 'unverified';
    const conf = status === 'verified' ? C.verified : status === 'conflict' ? C.two : d.agreeTwo ? C.two : C.one;
    const alts = d.cands.filter((c) => c.text !== d.chosen).map((c) => ({ value: (parseLengthLoose0(c.text) ?? 0), method: 'vision' as Method, source: src(d.box, c.text) }));
    u.dimensions.push({
      id: d.id, view: plane.pageId, a, b: bb,
      value: ex(`dimension.${d.id}`, d.m, 'vision', status, conf, d.box, { unit: 'm', checks: d.checks, text: d.chosen, ...(alts.length ? { alternatives: alts } : {}) }),
      ...(d.chain ? { chain: d.chain } : {}),
    });
    if (d.status === 'conflict') u.conflicts.push({ id: hash(`conflict.${d.id}`), field: `dimensions.${d.id}`, values: [d.chosen], message: d.conflictNote ?? 'printed value and drawing disagree' });
  }

  // ---- the three outputs
  const wallHeight = 2.75;
  const layout = { ...createEmptyProperty('raster').layout, wallHeightM: wallHeight, rooms: finalRooms, openings, scaleSource: 'plan-dimensions' as const };
  const v = validateLayout(layout);
  for (const e of v.errors) u.warnings.push(`Layout check: ${e}`);
  const spawn = chooseSpawn(layout, items);
  const nVerified = [...verifiedRoom.values()].filter(Boolean).length;
  const confidence = Math.min(0.9, 0.2 + 0.6 * (nVerified / Math.max(1, finalRooms.length)));
  const warnings = [...u.warnings, 'Picture of a plan: no ceiling height on the page. Set to 2.75 m. Confirm it.'];
  const proposal: LayoutProposal = { version: 1, source: 'drawing-import-raster@1', rooms: finalRooms, openings, wallHeightM: wallHeight, confidence, notes: warnings };
  const extras: ProposalExtras = {
    version: 1, sourceFile: 'image', planPage: pageNo,
    scale: { ptPerM: (sx + sy) / 2, votes: [{ source: b.fallback ? 'doors' : 'printed sizes', ptPerM: (sx + sy) / 2 }], agreeing: b.fit?.inliers ?? 0, disagreementPct: Math.round((b.fit?.spread ?? 1) * 1000) / 10 },
    rooms: findings, ceiling: { heightM: wallHeight, method: 'default', page: null, candidatesM: [], confidence: 0.2 }, furniture: items, unmapped,
    spawn, warnings,
  };
  const designs: DesignsFile = { version: 1, source: `Imported drawing set, ${u.input.pages} page${u.input.pages === 1 ? '' : 's'}`, items: {} };
  return { result: { proposal, extras }, designs };
}

const parseLengthLoose0 = (t: string): number | null => parseLengthLoose(t)?.m ?? null;
