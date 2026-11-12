// C8. SPEC 13.5: orchestration, VectorPage[] -> ImportResult. Pure TypeScript.
import type { Layout, LayoutProposal, Opening, Px, RoomTag, Vec2 } from '../types';
import { GRID_FREE } from '../types';
import { cellValue } from '../core/grid-codec';
import { pointInBox, pointInPolygon, polygonArea } from '../core/geometry';
import { defaultEdges } from '../core/layout-geom';
import { normalizeRoom, validateLayout, createEmptyProperty } from '../core/layout-validate';
import { rasterizeLayout, stampFurniture } from '../core/layout-raster';
import { ImportError } from './types';
import type { CeilingFinding, ImportResult, PageKind, ProposalExtras, RoomFinding, ScaleVote, VectorPage } from './types';
import { classifyPage, normalizePage, roomLabelCount } from './vector-page';
import { parseLabels } from './labels';
import type { FurnitureLabel, RoomLabel } from './labels';
import { bridgeGaps, selectWalls, wallBitmap } from './walls';
import { findRegions, pxSizeFor } from './regions';
import type { RegionResult } from './regions';
import { collectOutlines, matchOutline, outlineVotes, roomVotes, voteScale } from './scale';
import { buildOpenings } from './openings';
import { buildFurniture } from './furniture';
import { findCeiling, windowHeightsFromText } from './elevation';
import { WALL } from './bitmap';
import type { Bitmap } from './bitmap';

export interface ProposeOptions { /** 0-based page index to use as the plan */ planPage?: number }

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
const MIN_PATHS = 20;

/** Rectangle of the labelled size centred on the label, shifted up to 0.5 m per axis to meet the nearest wall faces. */
function labelRect(label: RoomLabel, dimsM: { w: number; l: number }, walls: Bitmap, ptPerM: number): Px[] {
  const cap = 6 * ptPerM;
  const ray = (dx: number, dy: number): number => {
    const step = walls.px * 0.5;
    for (let d = 0; d <= cap; d += step) if (walls.at({ x: label.centre.x + dx * d, y: label.centre.y + dy * d }) === WALL) return d;
    return Infinity;
  };
  const left = ray(-1, 0), right = ray(1, 0), up = ray(0, -1), down = ray(0, 1);
  const extX = Math.min(left, cap) + Math.min(right, cap), extY = Math.min(up, cap) + Math.min(down, cap);
  const longPt = Math.max(dimsM.w, dimsM.l) * ptPerM, shortPt = Math.min(dimsM.w, dimsM.l) * ptPerM;
  const W = extX >= extY ? longPt : shortPt;
  const H = extX >= extY ? shortPt : longPt;
  const maxShift = 0.5 * ptPerM;
  const place = (centre: number, size: number, lo: number, hi: number): number => {
    const a = centre - size / 2, b = centre + size / 2;
    const opts: number[] = [];
    if (Number.isFinite(lo)) opts.push(lo - a);
    if (Number.isFinite(hi)) opts.push(hi - b);
    const ok = opts.filter((s) => Math.abs(s) <= maxShift).sort((p, q) => Math.abs(p) - Math.abs(q));
    return centre + (ok[0] ?? 0);
  };
  const cx = place(label.centre.x, W, label.centre.x - left, label.centre.x + right);
  const cy = place(label.centre.y, H, label.centre.y - up, label.centre.y + down);
  return [{ x: cx - W / 2, y: cy - H / 2 }, { x: cx + W / 2, y: cy - H / 2 }, { x: cx + W / 2, y: cy + H / 2 }, { x: cx - W / 2, y: cy + H / 2 }];
}

function pickPlanPage(pages: ReturnType<typeof normalizePage>[], kinds: PageKind[], force?: number): number {
  if (force !== undefined) {
    if (force < 0 || force >= pages.length) throw new ImportError('no-plan-page', `Page ${force + 1} does not exist. The file has ${pages.length} pages.`);
    if (kinds[force] === 'raster') throw new ImportError('raster-plan', 'This plan is an image. Trace it in the editor.');
    return force;
  }
  const i = kinds.indexOf('plan');
  if (i >= 0) return i;
  // failing that, the page with the most room labels
  let best = -1, bestN = 0;
  pages.forEach((p, k) => { if (kinds[k] === 'raster' || kinds[k] === 'elevation') return; const n = roomLabelCount(p); if (n > bestN) { bestN = n; best = k; } });
  if (best >= 0) return best;
  // SPEC-GAP: 13.5 stops here with 'no-plan-page', but 13.11 item 13 wants a document with all its text removed to import
  // with 0 rooms and a scale guess, without throwing. So the busiest non-raster page stands in as the plan.
  let busiest = -1, most = MIN_PATHS - 1;
  pages.forEach((p, k) => { if (kinds[k] === 'raster' || kinds[k] === 'elevation') return; const n = p.fills.length + p.strokes.length; if (n > most) { most = n; busiest = k; } });
  if (busiest >= 0) return busiest;
  if (kinds.length && kinds.every((k) => k === 'raster')) throw new ImportError('raster-plan', 'This plan is an image. Trace it in the editor.');
  if (kinds.some((k) => k === 'raster')) throw new ImportError('raster-plan', 'This plan is an image. Trace it in the editor.');
  throw new ImportError('no-plan-page', 'No plan page found in this drawing.');
}

export function proposeFromPages(pagesIn: VectorPage[], sourceFile: string, sceneId: string, opts: ProposeOptions = {}): ImportResult {
  const warnings: string[] = [];
  const pages = pagesIn.map(normalizePage);
  const kinds = pages.map((p) => classifyPage(p));
  const planIdx = pickPlanPage(pages, kinds, opts.planPage);
  const plan = pages[planIdx];
  const elevations = pages.filter((_, k) => kinds[k] === 'elevation');

  // ---- walls, labels
  const walls = selectWalls(plan);
  const empty = (msg: string): ImportResult => ({
    proposal: { version: 1, source: 'drawing-import@1', rooms: [], openings: [], wallHeightM: 2.75, confidence: 0, notes: [...warnings, msg] },
    extras: {
      version: 1, sourceFile, planPage: planIdx + 1, scale: { ptPerM: 0, votes: [], agreeing: 0, disagreementPct: 0 }, rooms: [],
      ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 }, furniture: [], unmapped: [], spawn: null,
      warnings: [...warnings, msg],
    },
  });
  if (!walls.colors.length || !walls.polys.length) return empty('No walls found on the plan page. Trace the plan in the editor.');
  const t = walls.t;
  const { rooms: allRoomLabels, furniture: furnLabels } = parseLabels(plan.texts);
  const inFrame = (p: Px): boolean => {
    const m = 2 * t;
    return p.x >= walls.bbox[0] - m && p.x <= walls.bbox[2] + m && p.y >= walls.bbox[1] - m && p.y <= walls.bbox[3] + m;
  };
  // the title block and notes sit outside the walls and carry no size; a sized label (a balcony drawn outside the walls) stays
  const roomLabels = allRoomLabels.filter((l) => inFrame(l.centre) || l.dims || l.areaM2);
  const furniture = furnLabels.filter((l) => inFrame(l.centre));
  if (Math.abs(((walls.dominant * 180) / Math.PI + 45) % 90 - 45) > 1) warnings.push(`The walls run ${((walls.dominant * 180) / Math.PI).toFixed(1)} degrees off the page axes. Rooms are not levelled.`);

  // ---- gaps and regions
  const wallsOnly = wallBitmap(plan, walls, pxSizeFor(plan, t));
  const gaps = bridgeGaps(walls, wallsOnly);
  const { regions, bitmap } = findRegions(plan, walls, gaps, roomLabels);

  // ---- scale votes
  const outlines = collectOutlines(plan, walls);
  const votes: ScaleVote[] = [];
  const outlineOf = new Map<FurnitureLabel, ReturnType<typeof matchOutline>>();
  for (const l of furniture) {
    if (!l.dims || l.key === 'wardrobe') continue;
    const o = matchOutline(l, outlines, t);
    outlineOf.set(l, o);
    if (o) votes.push(...outlineVotes(o, l, `${l.key.toUpperCase()} ${fmtDims(l.dims)}`));
  }
  for (const r of regions) if (r.polygon && r.method !== 'label-rect') votes.push(...roomVotes(r.label, r.polygon, r.areaPt2));
  let ptPerM: number; let scaleConf: number;
  const result = voteScale(votes);
  let agreeing = 0; let disagreementPct = 0; let usedVotes = votes;
  if (result) {
    ptPerM = result.ptPerM; agreeing = result.agreeing; disagreementPct = result.disagreementPct; usedVotes = result.votes;
    scaleConf = agreeing >= 4 ? 0.9 : agreeing === 3 ? 0.8 : agreeing === 2 ? 0.7 : 0.4;
    if (agreeing < 2) warnings.push('Scale rests on one label. Check a door width.');
  } else {
    ptPerM = t / 0.23; scaleConf = 0.2;
    warnings.push('No dimensions found. Scale guessed from wall thickness.');
  }

  // ---- label rectangles for rooms that still leak
  const finalRegions: (RegionResult & { polygon: Px[] })[] = [];
  for (const r of regions) {
    if (r.polygon) { finalRegions.push(r as RegionResult & { polygon: Px[] }); continue; }
    if (!r.label.dims) { warnings.push(`Room "${r.label.name}" is not closed by walls and has no labelled size. Left out. Add it in the editor.`); continue; }
    const rect = labelRect(r.label, r.label.dims, bitmap, ptPerM);
    finalRegions.push({ ...r, polygon: rect, areaPt2: Math.abs(polygonArea(rect.map((p) => ({ x: p.x, z: p.y })))) });
  }
  for (const r of finalRegions) if (r.method === 'label-rect') warnings.push(`Room "${r.label.name}" is not closed by walls on the drawing. Drawn as a rectangle of its labelled size. Check it.`);
  if (!roomLabels.length) warnings.push('No room labels found on the plan. Add the rooms in the editor.');

  // ---- world frame: origin at the centre of the wall bbox
  const cxPt = (walls.bbox[0] + walls.bbox[2]) / 2, cyPt = (walls.bbox[1] + walls.bbox[3]) / 2;
  const toWorld = (p: Px): Vec2 => ({ x: (p.x - cxPt) / ptPerM, z: (p.y - cyPt) / ptPerM });

  // ---- rooms (largest first), polygon starting at its top-left vertex, positive signed area
  const ordered = [...finalRegions].sort((a, b) => b.areaPt2 - a.areaPt2);
  const usedIds = new Set<string>();
  const draft: { region: RoomFinding; tag: RoomTag }[] = [];
  for (const r of ordered) {
    let poly = r.polygon.map(toWorld);
    if (polygonArea(poly) < 0) poly = poly.reverse();
    let s = 0;
    poly.forEach((p, i) => { const q = poly[s]; if (p.z < q.z - 1e-6 || (Math.abs(p.z - q.z) <= 1e-6 && p.x < q.x)) s = i; });
    poly = [...poly.slice(s), ...poly.slice(0, s)];
    let id = slug(r.label.name); let k = 2; while (usedIds.has(id)) id = `${slug(r.label.name)}-${k++}`;
    usedIds.add(id);
    const tag: RoomTag = { id, roomType: r.label.roomType, label: r.label.name, polygon: poly, edges: poly.map(() => 'wall' as const) };
    const conf = r.method === 'walls' ? 0.9 : r.method === 'walls+strokes' ? 0.7 : 0.4;
    draft.push({
      tag,
      region: { id, label: r.label.name, roomType: r.label.roomType, method: r.method, confidence: conf, labelDims: r.label.dims, labelAreaM2: r.label.areaM2, areaM2: polygonArea(poly) },
    });
  }
  const tags = draft.map((d) => d.tag);
  const rooms: RoomTag[] = tags.map((tag) => normalizeRoom({ ...tag, edges: defaultEdges(tag, tags) }));

  // ---- openings
  const windowText = windowHeightsFromText(elevations);
  const op = buildOpenings(gaps, plan, t, ptPerM, toWorld, rooms, windowText);
  warnings.push(...op.warnings);
  const openings: Opening[] = op.openings;
  const windowHeights = openings.filter((o) => o.type === 'window').length === 1 && (windowText.sillM !== undefined || windowText.headM !== undefined)
    ? [{ openingId: openings.find((o) => o.type === 'window')!.id, sillM: openings.find((o) => o.type === 'window')!.sillM, headM: openings.find((o) => o.type === 'window')!.headM }]
    : undefined;

  // ---- furniture
  const fr = buildFurniture(furniture, outlines, t, ptPerM, toWorld, bitmap);
  const items = fr.items;

  // ---- ceiling
  const extents: number[] = [];
  for (const rm of rooms) {
    const xs = rm.polygon.map((p) => p.x), zs = rm.polygon.map((p) => p.z);
    extents.push(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs));
  }
  const ceilingRes = findCeiling(elevations, extents);
  const ceiling: CeilingFinding = ceilingRes.ceiling;
  warnings.push(...ceilingRes.warnings);
  if (!elevations.length && !ceilingRes.warnings.length) warnings.push('No elevation pages found. Ceiling height set to 2.75 m. Confirm it.');

  // ---- layout, validation, spawn
  const layout: Layout = { ...createEmptyProperty(sceneId).layout, wallHeightM: ceiling.heightM, rooms, openings, scaleSource: 'plan-dimensions' };
  const v = validateLayout(layout);
  for (const e of v.errors) warnings.push(`Layout check: ${e}`);
  const spawn = chooseSpawn(layout, items);
  if (!spawn && rooms.length) warnings.push('No clear spot for the starting position. Place it in the editor.');

  const confidence = Math.min(scaleConf, ...draft.map((d) => d.region.confidence), 1);
  const proposal: LayoutProposal = { version: 1, source: 'drawing-import@1', rooms, openings, wallHeightM: ceiling.heightM, confidence, notes: warnings };
  const extras: ProposalExtras = {
    version: 1, sourceFile, planPage: planIdx + 1,
    scale: { ptPerM, votes: usedVotes, agreeing, disagreementPct },
    rooms: draft.map((d) => d.region), ceiling, furniture: items, unmapped: fr.unmapped,
    ...(windowHeights ? { windowHeights } : {}), spawn, warnings,
  };
  return { proposal, extras };
}

function fmtDims(d: { w: number; l: number }): string {
  return `${d.w.toFixed(2)} x ${d.l.toFixed(2)} m`;
}

/**
 * SPEC 13.8. The centre of the largest room's bbox; if that point is inside a furniture box, step outward on a 0.25 m
 * lattice (nearest first) to the first point at least 0.3 m from every wall cell and furniture box.
 */
export function chooseSpawn(layout: Layout, furniture: ProposalExtras['furniture']): { x: number; z: number; yawDeg: number } | null {
  if (!layout.rooms.length) return null;
  const grid = stampFurniture(rasterizeLayout(layout), furniture);
  const largest = layout.rooms.reduce((a, b) => (polygonArea(b.polygon) > polygonArea(a.polygon) ? b : a));
  const xs = largest.polygon.map((p) => p.x), zs = largest.polygon.map((p) => p.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  if (cellValue(grid, cx, cz) === GRID_FREE && !furniture.some((f) => pointInBox({ x: cx, z: cz }, f.box))) return { x: cx, z: cz, yawDeg: 0 };
  const clear = (x: number, z: number): boolean => {
    const r = 0.3;
    for (let dx = -r; dx <= r + 1e-9; dx += grid.cellM) for (let dz = -r; dz <= r + 1e-9; dz += grid.cellM) {
      if (dx * dx + dz * dz > r * r) continue;
      if (cellValue(grid, x + dx, z + dz) !== GRID_FREE) return false;
    }
    for (const f of furniture) if (pointInBox({ x, z }, f.box, -r)) return false;
    return pointInPolygon({ x, z }, largest.polygon);
  };
  const half = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2;
  const n = Math.ceil(half / 0.25);
  const pts: { x: number; z: number; d: number }[] = [];
  for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) pts.push({ x: cx + i * 0.25, z: cz + j * 0.25, d: Math.hypot(i, j) });
  pts.sort((a, b) => a.d - b.d);
  for (const p of pts) if (clear(p.x, p.z)) return { x: p.x, z: p.z, yawDeg: 0 };
  return null;
}
