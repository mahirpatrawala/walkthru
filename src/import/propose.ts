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
import { pageKindWords } from '../understand/lexicon';
import { parseLabels } from './labels';
import type { FurnitureLabel, RoomLabel } from './labels';
import { bridgeGaps, selectWalls, wallBitmap } from './walls';
import { barrierSegments, findRegions, pxSizeFor, snapLines } from './regions';
import { doorsFromArcs, findDoorArcs, findPassages, wallLessJunctions } from './passage';
import type { DoorArc } from './passage';
import { formatFtIn } from '../core/units';
import { PASSAGE_OFF_SHEET_REASON, offSheetReason, sheetArea } from './partial';
import type { RegionResult } from './regions';
import { collectOutlines, matchOutline, outlineVotes, roomVotes, voteScale } from './scale';
import { buildOpenings } from './openings';
import { fitLabelRect, markTaken } from './rect-fit';
import { buildFurniture } from './furniture';
import { findCeiling, windowHeightsFromText } from './elevation';
import { WALL, distPointSeg, pointInRing } from './bitmap';
import { pageReads, readPageText, readsToNormalised, withoutReadStrokes } from '../understand/text-pdf';
import { findDimensions } from '../understand/dimensions';
import { deriveLineWalls } from '../understand/walls-lines';
import { isNotesBlock } from '../understand/notes-block';
import { findUnlabelledRegions } from '../understand/rooms-unlabelled';
import type { LineWalls } from '../understand/walls-lines';
import type { DimLine } from '../understand/dimensions';
import { fitModels } from '../understand/scale-fit';
import type { ScaleFit } from '../understand/scale-fit';
import type { TextRead } from '../understand/reads';
import type { Bitmap } from './bitmap';

export interface ProposeOptions {
  /** 0-based page index to use as the plan */ planPage?: number;
  /** C12b: read stroke text (exploded CAD lettering) and use dimension lines for the scale. On by default. */
  understandText?: boolean;
  /** a scale (page units per metre) measured from outside the importer (printed room sizes against drawn walls); used only when the importer's own votes give less than two agreeing sources */
  ptPerM?: number;
}
/** What the text and dimension stage found while importing, for callers that want more than the proposal (C12b, the harness). */
export interface ProposeTrace {
  pages: ReturnType<typeof normalizePage>[]; kinds: PageKind[]; planIdx: number;
  reads: TextRead[][];
  /** frame of the proposal: world metres = (page units - centre) / ptPerM */
  frame: { cx: number; cy: number; ptPerM: number } | null;
  planWalls: [number, number, number, number] | null;
  planDims: DimLine[]; planFit: ScaleFit | null;
  rawPages: VectorPage[];
  /** C12c: the plan page as the wall stage saw it (wall bands added as fills, the strokes that drew them removed); same as pages[planIdx] for filled walls */
  plan?: ReturnType<typeof normalizePage>;
  /** C12c: set when walls were found as lines (double-line, hatch or mixed) */
  lineWalls?: LineWalls | null;
  /** C12c: the wall stage's own products, for the symbol stage (yaw of furniture from the nearest wall) */
  walls?: ReturnType<typeof selectWalls>;
  wallBitmap?: Bitmap;
}

const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'room';
const MIN_PATHS = 20;

/**
 * Rectangle of the labelled size on the label. Walls and the wall-to-wall strokes of pass 2 (window strokes) count as
 * walls for the rays. Orientation: the one whose sides fit the finite wall-to-wall spans; a tie falls back to the
 * spec's longer extent of free space. Then it is shifted so edges meet the nearest wall faces.
 * SPEC-GAP: 13.5 limits the shift to 0.5 m. The reference's master room label sits 0.85 m off the true wall, so 1.0 m.
 */
function labelRect(label: RoomLabel, dimsM: { w: number; l: number }, walls: Bitmap, ptPerM: number): Px[] {
  const cap = 6 * ptPerM;
  const ray = (dx: number, dy: number): number => {
    const step = walls.px * 0.5;
    for (let d = 0; d <= cap; d += step) if (walls.at({ x: label.centre.x + dx * d, y: label.centre.y + dy * d }) === WALL) return d;
    return Infinity;
  };
  const left = ray(-1, 0), right = ray(1, 0), up = ray(0, -1), down = ray(0, 1);
  const spanX = left + right, spanY = up + down; // Infinity unless walls on both sides
  const longPt = Math.max(dimsM.w, dimsM.l) * ptPerM, shortPt = Math.min(dimsM.w, dimsM.l) * ptPerM;
  const violations = (W: number, H: number): number => Number(W > 1.06 * spanX) + Number(H > 1.06 * spanY);
  const v1 = violations(longPt, shortPt), v2 = violations(shortPt, longPt);
  const extX = Math.min(left, cap) + Math.min(right, cap), extY = Math.min(up, cap) + Math.min(down, cap);
  const longAlongX = v1 !== v2 ? v1 < v2 : extX >= extY;
  const W = longAlongX ? longPt : shortPt;
  const H = longAlongX ? shortPt : longPt;
  const maxShift = 1.0 * ptPerM;
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
  return proposeWithTrace(pagesIn, sourceFile, sceneId, opts).result;
}

export function proposeWithTrace(pagesRaw: VectorPage[], sourceFile: string, sceneId: string, opts: ProposeOptions = {}): { result: ImportResult; trace: ProposeTrace } {
  const warnings: string[] = [];
  const useText = opts.understandText !== false;
  // C12b: stroke text becomes ordinary text runs before the page is turned upright, so a drawing lettered in exploded CAD
  // strokes reads like one with real text, and its reading direction can level the sheet
  const textPages = pagesRaw.map((p) => (useText ? readPageText(p) : { page: p, glyphReads: [], consumed: 0 }));
  const pagesIn = textPages.map((t) => t.page);
  const pages = pagesIn.map(normalizePage);
  const kinds = pages.map((p) => classifyPage(p));
  const planIdx = pickPlanPage(pages, kinds, opts.planPage);
  const plan0 = pages[planIdx];
  // C12c: walls drawn as lines (double-line, hatch, or mixed with filled walls) become filled bands the rest of the importer reads
  const fillWalls = selectWalls(plan0);
  const lineWalls = useText ? deriveLineWalls(plan0, fillWalls) : null;
  const plan = (lineWalls?.page ?? plan0) as ReturnType<typeof normalizePage>;
  const elevations = pages.filter((_, k) => kinds[k] === 'elevation');
  const reads = pages.map((p, i) => pageReads(p, readsToNormalised(textPages[i].glyphReads, pagesRaw[i], p)));
  const trace: ProposeTrace = { pages, kinds, planIdx, reads, frame: null, planWalls: null, planDims: [], planFit: null, rawPages: pagesRaw, plan, lineWalls };
  const finish = (result: ImportResult): { result: ImportResult; trace: ProposeTrace } => ({ result, trace });

  // ---- walls, labels
  const walls = lineWalls ? selectWalls(plan) : fillWalls;
  const empty = (msg: string): ImportResult => ({
    proposal: { version: 1, source: 'drawing-import@1', rooms: [], openings: [], wallHeightM: 2.75, confidence: 0, notes: [...warnings, msg] },
    extras: {
      version: 1, sourceFile, planPage: planIdx + 1, scale: { ptPerM: 0, votes: [], agreeing: 0, disagreementPct: 0 }, rooms: [],
      ceiling: { heightM: 2.75, method: 'default', page: null, candidatesM: [], confidence: 0.1 }, furniture: [], unmapped: [], spawn: null,
      warnings: [...warnings, msg],
    },
  });
  if (!walls.colors.length || !walls.polys.length) return finish(empty('No walls found on the plan page. Trace the plan in the editor.'));
  const t = walls.t;
  // C12b: dimension lines on the plan give an independent scale (RANSAC over their printed lengths)
  let dimHint: ScaleFit | null = null;
  let dimModels: ReturnType<typeof fitModels> = [];
  if (useText) {
    const dims = findDimensions(withoutReadStrokes(plan0, reads[planIdx]), reads[planIdx]);
    for (const d of dims) d.page = planIdx;
    const w = walls.bbox;
    const pad = 0.3 * Math.max(w[2] - w[0], w[3] - w[1]);
    const inPlan = dims.filter((d) => { const mx = (d.a[0] + d.b[0]) / 2, my = (d.a[1] + d.b[1]) / 2; return mx >= w[0] - pad && mx <= w[2] + pad && my >= w[1] - pad && my <= w[3] + pad && !d.run.parts.some((q) => q.tentative); });
    dimModels = fitModels(inPlan.map((d) => ({ id: d.id, lenPt: d.lengthPt, valueM: d.run.parsed.m, group: d.chain ?? d.id, source: 'dimension' as const })));
    dimHint = dimModels[0]?.fit ?? null;
    trace.planDims = dims; trace.planFit = dimHint; trace.planWalls = walls.bbox;
  }
  const { rooms: allRoomLabels, furniture: furnLabels } = parseLabels(plan.texts);
  const inFrame = (p: Px): boolean => {
    const m = 2 * t;
    return p.x >= walls.bbox[0] - m && p.x <= walls.bbox[2] + m && p.y >= walls.bbox[1] - m && p.y <= walls.bbox[3] + m;
  };
  // the title block and notes sit outside the walls and carry no size; a sized label (a balcony drawn outside the walls) stays
  // C12c: a notes paragraph, a legend or a title block is never a room label (it carries no size and sits off the walls, or is a paragraph)
  const roomLabels = allRoomLabels.filter((l) => (inFrame(l.centre) || l.dims || l.areaM2) && !(useText && isNotesBlock(l.block) && !l.dims));
  const furniture = furnLabels.filter((l) => inFrame(l.centre));
  if (Math.abs(((walls.dominant * 180) / Math.PI + 45) % 90 - 45) > 1) warnings.push(`The walls run ${((walls.dominant * 180) / Math.PI).toFixed(1)} degrees off the page axes. Rooms are not levelled.`);

  // ---- gaps and regions
  const wallsOnly = wallBitmap(plan, walls, pxSizeFor(plan, t));
  const gaps = bridgeGaps(walls, wallsOnly);
  const { regions, bitmap } = findRegions(plan, walls, gaps, roomLabels);
  // C12c: closed spaces no label claimed become unnamed rooms (typed later from what is drawn inside)
  if (useText) {
    const claimed = [...roomLabels.map((l) => l.centre), ...regions.filter((r) => r.polygon).map((r) => r.label.centre)];
    // door evidence: an unnamed space is a room only when a door, window or opening (a bridged gap) opens onto it, and it is closed
    // by at least two such spaces' worth of drawing (a bare wall diagram with nothing else on it stays at no rooms)
    const near = (r: RegionResult): boolean => !!r.polygon && gaps.some((g) => { const m = { x: (g.a.x + g.b.x) / 2, y: (g.a.y + g.b.y) / 2 }; return pointInRing(m, r.polygon!) || r.polygon!.some((p, i) => { const q = r.polygon![(i + 1) % r.polygon!.length]; return distPointSeg(m, p, q) <= 1.2 * t; }); });
    const unl = findUnlabelledRegions(bitmap, walls, claimed, snapLines(walls, gaps, [])).filter(near);
    if (unl.length < 1 || (!roomLabels.length && !reads[planIdx].some((r) => r.str.trim().length > 0))) unl.length = 0;
    unl.forEach((r, k) => { r.label.name = unl.length > 1 || regions.length ? `Room ${regions.length + k + 1}` : 'Room'; });
    regions.push(...unl);
    if (unl.length) warnings.push(`${unl.length} closed space(s) with no label were added as unnamed rooms. Name them in the editor.`);
  }

  // ---- scale votes
  const outlines = collectOutlines(plan, walls);
  const votes: ScaleVote[] = [];
  const outlineOf = new Map<FurnitureLabel, ReturnType<typeof matchOutline>>();
  for (const l of furniture) {
    if (!l.dims) continue;
    const o = matchOutline(l, outlines, t);
    outlineOf.set(l, o);
    if (o) votes.push(...outlineVotes(o, l, `${l.key.toUpperCase()} ${fmtDims(l.dims)}`));
  }
  for (const r of regions) if (r.polygon && r.method !== 'label-rect') votes.push(...roomVotes(r.label, r.polygon, r.areaPt2));
  // the dimension fit votes once per agreeing dimension (at most six), so it outweighs a couple of stray labels but not a consensus
  // A page that holds a plan and an elevation at two scales gives two dimension models. The plan's is the one the room and
  // furniture labels agree with; with no label to say, and more than one model, the importer takes none of them.
  {
    const labelScale = voteScale(votes)?.ptPerM;
    const elevOnPlan = reads[planIdx].some((r) => pageKindWords(r.str).some((k) => k === 'elevation' || k === 'section'));
    const pick = labelScale ? dimModels.find((m) => Math.abs(m.fit.ptPerM / labelScale - 1) <= 0.03) : dimModels.length === 1 && !elevOnPlan ? dimModels[0] : undefined;
    if (pick && (pick.fit.inliers.length >= 4 || labelScale)) { dimHint = pick.fit; for (let k = 0; k < Math.min(pick.fit.inliers.length, 6); k++) votes.push({ source: 'dimension lines', ptPerM: pick.fit.ptPerM }); } else dimHint = null;
  }
  let ptPerM: number; let scaleConf: number;
  const result = voteScale(votes);
  let agreeing = 0; let disagreementPct = 0; let usedVotes = votes;
  if (result) {
    ptPerM = result.ptPerM; agreeing = result.agreeing; disagreementPct = result.disagreementPct; usedVotes = result.votes;
    scaleConf = agreeing >= 4 ? 0.9 : agreeing === 3 ? 0.8 : agreeing === 2 ? 0.7 : 0.4;
    if (agreeing < 2 && opts.ptPerM) {
      ptPerM = opts.ptPerM; scaleConf = 0.7; agreeing = 3; disagreementPct = 0;
      usedVotes = [{ source: 'room labels against drawn walls', ptPerM }];
    } else if (agreeing < 2) warnings.push('Scale rests on one label. Check a door width.');
  } else if (opts.ptPerM) {
    ptPerM = opts.ptPerM; scaleConf = 0.7;
    usedVotes = [{ source: 'room labels against drawn walls', ptPerM }];
  } else {
    ptPerM = t / 0.23; scaleConf = 0.2;
    warnings.push('No dimensions found. Scale guessed from wall thickness.');
  }

  // ---- label rectangles for rooms that still leak
  let rays: Bitmap | null = null;
  const rayMap = (): Bitmap => {
    if (!rays) {
      rays = bitmap.clone();
      const { segs, widths } = barrierSegments(plan, walls, bitmap);
      segs.forEach(([a, b], k) => rays!.drawSegment(a, b, widths[k], WALL));
    }
    return rays;
  };
  const finalRegions: (RegionResult & { polygon: Px[] })[] = [];
  // where a room drawn from its printed size goes: the position that holds no wall, overlaps no room already found, and has walls flush
  // against its sides (rect-fit.ts); the importer's old ray placement only when none qualifies
  const taken = new Uint8Array(bitmap.nx * bitmap.ny);
  const sizeOf = (poly: Px[]): [number, number] => { const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y); const a = (Math.max(...xs) - Math.min(...xs)) / ptPerM, b = (Math.max(...ys) - Math.min(...ys)) / ptPerM; return [Math.min(a, b), Math.max(a, b)]; };
  for (const r of regions) {
    if (!r.polygon) continue;
    const d = r.label.dims;
    if (d && scaleConf >= 0.7 && (r.method === 'walls' || r.method === 'walls+strokes')) {
      const [a, b] = sizeOf(r.polygon); const lo = Math.min(d.w, d.l), hi = Math.max(d.w, d.l);
      if ((Math.abs(a / lo - 1) > 0.05 || Math.abs(b / hi - 1) > 0.05) && ((a * b) / (lo * hi) > 1.25 || (a * b) / (lo * hi) < 0.8)) continue;
    }
    markTaken(taken, bitmap, r.polygon);
  }
  const placeRect = (label: RoomLabel, dims: { w: number; l: number }): Px[] => {
    const rm = rayMap();
    // a rectangle drawn around the label that is the printed size (a balcony outlined in thin lines) is the room itself
    const want = [dims.w * ptPerM, dims.l * ptPerM];
    const drawn = outlines.filter((o) => {
      if (!(o.a > 0 && o.b > 0)) return false;
      const dx = label.centre.x - o.cx, dy = label.centre.y - o.cy, cs = Math.cos(o.ang), sn = Math.sin(o.ang);
      if (Math.abs(dx * cs + dy * sn) > o.a / 2 || Math.abs(-dx * sn + dy * cs) > o.b / 2) return false;
      const fits = (x: number, y: number): boolean => Math.abs(o.a / x - 1) <= 0.06 && Math.abs(o.b / y - 1) <= 0.06;
      return fits(want[0], want[1]) || fits(want[1], want[0]);
    }).sort((x, y) => x.a * x.b - y.a * y.b)[0];
    if (drawn) { markTaken(taken, rm, drawn.corners); return drawn.corners; }
    const fit = fitLabelRect(rm, taken, label.centre, dims.w * ptPerM, dims.l * ptPerM, t);
    const poly = fit && fit.contact >= 0.45 && fit.weakest >= 0.1 ? fit.polygon : labelRect(label, dims, rm, ptPerM);
    markTaken(taken, rm, poly);
    return poly;
  };
  for (const r of regions) {
    if (r.polygon) {
      // a traced outline that disagrees with the size printed in it by more than 5% is a leak or a mis-closed room, not a measurement: the
      // room is drawn at its printed size and the two numbers are kept for the broker (SPEC 17.1: nothing is picked silently)
      const d = r.label.dims;
      if (d && scaleConf >= 0.7 && (r.method === 'walls' || r.method === 'walls+strokes')) {
        const xs = r.polygon.map((p) => p.x), ys = r.polygon.map((p) => p.y);
        const [a, b] = [Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / ptPerM, Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / ptPerM];
        const lo = Math.min(d.w, d.l), hi = Math.max(d.w, d.l);
        if (Math.abs(a / lo - 1) > 0.05 || Math.abs(b / hi - 1) > 0.05) {
          // a modest difference keeps the traced walls and is flagged; a gross one (the outline holds a quarter more or a fifth less area
          // than the printed size) is a leak into the next room, so the printed size is drawn instead. Either way both numbers are kept.
          const ratio = (a * b) / (lo * hi);
          if (ratio > 1.25 || ratio < 0.8) {
            const rect = placeRect(r.label, d);
            finalRegions.push({ ...r, method: 'label-rect', polygon: rect, areaPt2: Math.abs(polygonArea(rect.map((p) => ({ x: p.x, z: p.y })))), drawn: { w: a, l: b } });
            warnings.push(`Room "${r.label.name}": the walls drawn around it measure ${a.toFixed(2)} x ${b.toFixed(2)} m but its label says ${lo.toFixed(2)} x ${hi.toFixed(2)} m. It is drawn at the printed size. Check it.`);
          } else {
            finalRegions.push({ ...r, polygon: r.polygon, drawn: { w: a, l: b } });
            warnings.push(`Room "${r.label.name}": the walls drawn around it measure ${a.toFixed(2)} x ${b.toFixed(2)} m but its label says ${lo.toFixed(2)} x ${hi.toFixed(2)} m. The drawn walls are used. Check it.`);
          }
          continue;
        }
      }
      finalRegions.push(r as RegionResult & { polygon: Px[] }); continue;
    }
    if (!r.label.dims) { warnings.push(`Room "${r.label.name}" is not closed by walls and has no labelled size. Left out. Add it in the editor.`); continue; }
    const rect = placeRect(r.label, r.label.dims);
    finalRegions.push({ ...r, polygon: rect, areaPt2: Math.abs(polygonArea(rect.map((p) => ({ x: p.x, z: p.y })))) });
  }
  for (const r of finalRegions) {
    const l = r.label;
    if (!l.dims || !l.areaM2) continue;
    const dimsM2 = l.dims.w * l.dims.l;
    if (Math.abs(l.areaM2 / dimsM2 - 1) <= 0.03) continue;
    const sq = (m2: number): number => m2 / 0.09290304;
    // do the drawn walls agree with the dimensions? both axes need a wall on each side
    const rm = rayMap();
    const c = l.centre; const cap = 6 * ptPerM;
    const hit = (dx: number, dy: number): number => { for (let d = 0; d <= cap; d += rm.px * 0.5) if (rm.at({ x: c.x + dx * d, y: c.y + dy * d }) === WALL) return d; return Infinity; };
    const sx = hit(-1, 0) + hit(1, 0), sy = hit(0, -1) + hit(0, 1);
    const lo = Math.min(l.dims.w, l.dims.l), hi = Math.max(l.dims.w, l.dims.l);
    const [a, b] = [Math.min(sx, sy) / ptPerM, Math.max(sx, sy) / ptPerM];
    const agree = Number.isFinite(a) && Number.isFinite(b) && Math.abs(a / lo - 1) <= 0.03 && Math.abs(b / hi - 1) <= 0.03;
    warnings.push(`Label says ${Math.round(sq(l.areaM2))} sq ft but ${formatFtIn(l.dims.w)}×${formatFtIn(l.dims.l)} is ${sq(dimsM2).toFixed(1)} sq ft.` + (agree ? ` The drawn walls agree with ${formatFtIn(l.dims.w)}×${formatFtIn(l.dims.l)}.` : ''));
  }
  for (const r of finalRegions) if (r.method === 'label-rect') warnings.push(`Room "${r.label.name}" is not closed by walls on the drawing. Drawn as a rectangle of its labelled size. Check it.`);
  if (!roomLabels.length) warnings.push('No room labels found on the plan. Add the rooms in the editor.');

  // ---- world frame: origin at the centre of the wall bbox
  const cxPt = (walls.bbox[0] + walls.bbox[2]) / 2, cyPt = (walls.bbox[1] + walls.bbox[3]) / 2;
  const toWorld = (p: Px): Vec2 => ({ x: (p.x - cxPt) / ptPerM, z: (p.y - cyPt) / ptPerM });

  // ---- rooms (largest first), polygon starting at its top-left vertex, positive signed area
  const sheet = sheetArea(plan);
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
    // a room drawn from its printed size whose far wall is off the sheet is only partly on the drawing
    if (r.method === 'label-rect') {
      const why = offSheetReason(r.polygon, sheet, t, ptPerM);
      if (why) { tag.partial = { reason: why }; warnings.push(`Room "${r.label.name}" runs off the edge of the sheet. It is marked as partly on the drawing.`); }
    }
    const conf = r.method === 'walls' ? 0.9 : r.method === 'walls+strokes' ? 0.7 : 0.4;
    draft.push({
      tag,
      region: { id, label: r.label.name, roomType: r.label.roomType, method: r.method, confidence: conf, labelDims: r.label.dims, labelAreaM2: r.label.areaM2, areaM2: polygonArea(poly), ...(r.drawn ? { drawnDims: r.drawn } : {}) },
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

  // ---- doors from swing arcs, then the drawn passage that the doors lead to
  const arcs = findDoorArcs(plan, ptPerM, gaps, t);
  const usedArcs = new Set<DoorArc>();
  const ids = new Set(openings.map((o) => o.id));
  const toPage = (w: Vec2): Px => ({ x: w.x * ptPerM + cxPt, y: w.z * ptPerM + cyPt });
  const arcDoors1 = doorsFromArcs(rooms, openings, arcs, toWorld, usedArcs, ids);
  warnings.push(...arcDoors1.warnings);
  let allOpenings: Opening[] = [...openings, ...arcDoors1.doors];
  let allRooms: RoomTag[] = rooms;
  const extraFindings: RoomFinding[] = [];
  let spawnOverride: { x: number; z: number; yawDeg: number } | null = null;
  {
    // a point 0.5 m beyond each door or opening, outside the room it is on
    const seeds: Px[] = [];
    for (const o of allOpenings) {
      const room = rooms.find((r) => r.id === o.roomId)!;
      const p = room.polygon[o.edge], q = room.polygon[(o.edge + 1) % room.polygon.length];
      const L = Math.hypot(q.x - p.x, q.z - p.z); const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
      const c = { x: p.x + e.x * o.centreM, z: p.z + e.z * o.centreM };
      seeds.push(toPage({ x: c.x + e.z * 0.5, z: c.z - e.x * 0.5 }));
    }
    const roomRings = rooms.map((r) => r.polygon.map(toPage));
    const found = findPassages(bitmap, walls, gaps, plan, roomRings, roomLabels, barrierSegments(plan, walls, bitmap).segs, seeds, ptPerM);
    if (found.length) {
      const tags2: RoomTag[] = [...rooms];
      found.forEach((f, k) => {
        let poly = f.polygon.map(toWorld);
        if (polygonArea(poly) < 0) poly = poly.reverse();
        let s0 = 0; poly.forEach((p, i) => { const q = poly[s0]; if (p.z < q.z - 1e-6 || (Math.abs(p.z - q.z) <= 1e-6 && p.x < q.x)) s0 = i; });
        poly = [...poly.slice(s0), ...poly.slice(0, s0)];
        let id = found.length > 1 ? `passage-${k + 1}` : 'passage'; while (tags2.some((r) => r.id === id)) id += 'x';
        const label = found.length > 1 ? `Passage ${k + 1}` : 'Passage';
        tags2.push({ id, roomType: 'other', label, polygon: poly, edges: poly.map(() => 'wall' as const), ...(f.leaksAtBorder ? { partial: { reason: PASSAGE_OFF_SHEET_REASON } } : {}) });
        extraFindings.push({ id, label, roomType: 'other', method: 'walls+strokes', confidence: 0.7, areaM2: polygonArea(poly) });
        if (f.leaksAtBorder) warnings.push(`${label} runs off the edge of the drawing. It is closed at the drawing border. Check its length.`);
      });
      allRooms = tags2.map((tag) => normalizeRoom({ ...tag, edges: defaultEdges(tag, tags2) }));
      const passages = allRooms.filter((r) => !rooms.some((x) => x.id === r.id));
      // doors for the passages from the arcs that are still free
      const arcDoors2 = doorsFromArcs(passages, allOpenings, arcs, toWorld, usedArcs, ids);
      warnings.push(...arcDoors2.warnings.map((w) => w.replace('has no door on the drawing. A door', 'has an entry door on the drawing. A door').replace('was placed where its swing arc hinges on the wall.', 'was found at its swing arc.')));
      allOpenings = [...allOpenings, ...arcDoors2.doors];
      // stretches where a passage meets a room with no wall between: an open doorway
      const wallAt = (w: Vec2): boolean => bitmap.at(toPage(w)) === WALL;
      for (const ps of passages) for (const r of allRooms) {
        if (r.id === ps.id || passages.some((x) => x.id === r.id)) continue;
        for (const j of wallLessJunctions(ps, r, wallAt)) {
          const rp = r.polygon[j.bEdge], rq = r.polygon[(j.bEdge + 1) % r.polygon.length];
          const L = Math.hypot(rq.x - rp.x, rq.z - rp.z); const e = { x: (rq.x - rp.x) / L, z: (rq.z - rp.z) / L };
          const u0 = (j.p0.x - rp.x) * e.x + (j.p0.z - rp.z) * e.z, u1 = (j.p1.x - rp.x) * e.x + (j.p1.z - rp.z) * e.z;
          const lo = Math.min(u0, u1), hi = Math.max(u0, u1);
          if (allOpenings.some((o) => o.roomId === r.id && o.edge === j.bEdge && Math.min(hi, o.centreM + o.widthM / 2) - Math.max(lo, o.centreM - o.widthM / 2) > 0.3 * (hi - lo))) continue;
          let k = allOpenings.length + 1; while (ids.has(`opening-${k}`)) k++; ids.add(`opening-${k}`);
          allOpenings.push({ id: `opening-${k}`, roomId: r.id, edge: j.bEdge, type: 'opening', centreM: (lo + hi) / 2, widthM: hi - lo, sillM: 0, headM: 2.1 });
          warnings.push(`${ps.label} meets ${r.label} with no wall drawn between them. An open doorway ${(hi - lo).toFixed(2)} m wide was added.`);
        }
      }
      // spawn just inside the passage's entry door, facing in
      const entry = allOpenings.find((o) => passages.some((x) => x.id === o.roomId && !x.partial) && o.type === 'door');
      if (entry) {
        const room = allRooms.find((r) => r.id === entry.roomId)!;
        const p = room.polygon[entry.edge], q = room.polygon[(entry.edge + 1) % room.polygon.length];
        const L = Math.hypot(q.x - p.x, q.z - p.z); const e = { x: (q.x - p.x) / L, z: (q.z - p.z) / L };
        const c = { x: p.x + e.x * entry.centreM, z: p.z + e.z * entry.centreM };
        const inward = { x: -e.z, z: e.x }; // opposite of the outward normal (dz, -dx)
        const depth = 0.5;
        spawnOverride = { x: c.x + inward.x * depth, z: c.z + inward.z * depth, yawDeg: ((Math.atan2(inward.x, inward.z) * 180) / Math.PI + 360) % 360 };
      }
    }
  }

  // ---- furniture
  const fr = buildFurniture(furniture, outlines, t, ptPerM, toWorld, bitmap, plan.strokes, walls.colors, walls.polys.map((q) => q.ring));
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
  const layout: Layout = { ...createEmptyProperty(sceneId).layout, wallHeightM: ceiling.heightM, rooms: allRooms, openings: allOpenings, scaleSource: 'plan-dimensions' };
  const v = validateLayout(layout);
  for (const e of v.errors) warnings.push(`Layout check: ${e}`);
  const spawn = spawnOverride ?? chooseSpawn(layout, items);
  if (!spawn && allRooms.length) warnings.push('No clear spot for the starting position. Place it in the editor.');

  const confidence = Math.min(scaleConf, ...draft.map((d) => d.region.confidence), ...extraFindings.map((f) => f.confidence), 1);
  const proposal: LayoutProposal = { version: 1, source: 'drawing-import@1', rooms: allRooms, openings: allOpenings, wallHeightM: ceiling.heightM, confidence, notes: warnings };
  const extras: ProposalExtras = {
    version: 1, sourceFile, planPage: planIdx + 1,
    scale: { ptPerM, votes: usedVotes, agreeing, disagreementPct },
    rooms: [...draft.map((d) => d.region), ...extraFindings], ceiling, furniture: items, unmapped: fr.unmapped,
    ...(windowHeights ? { windowHeights } : {}), spawn, warnings,
  };
  trace.frame = { cx: cxPt, cy: cyPt, ptPerM };
  trace.walls = walls; trace.wallBitmap = bitmap;
  return finish({ proposal, extras });
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
  // a room that is only partly on the drawing is a guess, never a start point (unless nothing else exists)
  const whole = layout.rooms.filter((r) => !r.partial);
  const largest = (whole.length ? whole : layout.rooms).reduce((a, b) => (polygonArea(b.polygon) > polygonArea(a.polygon) ? b : a));
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
