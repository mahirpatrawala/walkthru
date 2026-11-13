// C12b. The text-and-dimensions stage as one call: from a finished import (and its trace) to every dimension string on every
// page with its status, plus honest statuses for the rooms (label against traced polygon at the dimension-fitted scale).
// Pure TypeScript. The harness and the later chunks (C12c writers) call this; nothing here touches the network.
import type { ImportResult } from '../import/types';
import type { ProposeTrace } from '../import/propose';
import { findDimensions } from './dimensions';
import { withoutReadStrokes } from './text-pdf';
import type { DimLine } from './dimensions';
import { fitScale } from './scale-fit';
import { pageKindWords } from './lexicon';
import type { Pair, ScaleFit } from './scale-fit';
import type { Status } from './types';
import { extractDimension, labelAreaCheck, sideCheck, verifyDimensions } from './verify';
import type { DimVerdict, PageVerdict } from './verify';

export interface AnalysedDim {
  string: string; a: [number, number]; b: [number, number]; role: 'plan' | 'elevation'; status: Status;
  page: number; verdict: DimVerdict;
}
export interface Analysis {
  dims: AnalysedDim[];
  pages: PageVerdict[];
  /** the independent scale of the plan, when the dimensions give one */
  planFit: ScaleFit | null;
  roomStatus: Map<string, Status>;
  warnings: string[];
}

const PLAN_PAD = 0.3;

/** Everything the text stage knows about an import. */
export function analyseTrace(result: ImportResult, trace: ProposeTrace): Analysis {
  const warnings: string[] = [];
  const all: DimLine[] = [];
  trace.pages.forEach((pg, i) => {
    const dims = i === trace.planIdx && trace.planDims.length ? trace.planDims : findDimensions(withoutReadStrokes(pg, trace.reads[i]), trace.reads[i]);
    for (const d of dims) d.page = i;
    all.push(...dims);
  });
  // label pairs for the plan page: each traced room's sides against the sizes its label states (never a label-rect room)
  const ptPerM = trace.frame?.ptPerM ?? 0;
  const labelPairs: Pair[] = [];
  for (const f of result.extras.rooms) {
    if (!f.labelDims || f.method === 'label-rect') continue;
    const room = result.proposal.rooms.find((x) => x.id === f.id);
    if (!room || !ptPerM) continue;
    const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
    const bw = Math.max(...xs) - Math.min(...xs), bh = Math.max(...zs) - Math.min(...zs);
    const lo = Math.min(f.labelDims.w, f.labelDims.l), hi = Math.max(f.labelDims.w, f.labelDims.l);
    labelPairs.push(
      { id: `room-${f.id}-s`, lenPt: Math.min(bw, bh) * ptPerM, valueM: lo, group: `room-${f.id}`, source: 'label' },
      { id: `room-${f.id}-l`, lenPt: Math.max(bw, bh) * ptPerM, valueM: hi, group: `room-${f.id}`, source: 'label' },
    );
  }
  const verdicts = verifyDimensions({ dims: all, extra: (page) => (page === trace.planIdx ? labelPairs : []), pageSize: (page) => Math.max(trace.pages[page].width, trace.pages[page].height) });
  // the plan role: a dimension on the plan page that sits within the walls' extent (padded) or is judged by the model the room labels joined
  const walls = trace.planWalls;
  const padW = walls ? PLAN_PAD * Math.max(walls[2] - walls[0], walls[3] - walls[1]) : 0;
  const out: AnalysedDim[] = [];
  const cx = trace.frame?.cx ?? 0, cy = trace.frame?.cy ?? 0;
  // metres: at the plan's own dimension fit when it has one (independent of any label), else at the importer's scale
  const frameScale = (): number => planFitScale || ptPerM || 1;
  const planFitScale = fitScale(all.filter((d) => d.page === trace.planIdx && !d.run.parts.some((p) => p.tentative)).map((d) => ({ id: d.id, lenPt: d.lengthPt, valueM: d.run.parsed.m, group: d.chain ?? d.id, source: 'dimension' as const })))?.ptPerM ?? 0;
  let demoted = 0;
  const pending: { d: DimLine; v: DimVerdict; role: 'plan' | 'elevation'; page: number; pv: PageVerdict }[] = [];
  // where the traced rooms sit on the sheet, page units: dimension lines hug a building, so the plan's lie within a couple of metres of it
  // (and only a little way off its right-hand side, where a sheet-mate elevation starts)
  const roomsBox = ((): [number, number, number, number] | null => {
    if (!trace.frame || !result.proposal.rooms.length) return null;
    const pts = result.proposal.rooms.flatMap((r) => r.polygon);
    const k = trace.frame.ptPerM;
    const xs = pts.map((p) => p.x * k + trace.frame!.cx), ys = pts.map((p) => p.z * k + trace.frame!.cy);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  })();
  for (const pv of verdicts) {
    const isPlanSheet = pv.page === trace.planIdx;
    // a page the importer fell back on as the plan (no walls, no plan caption) is not evidence of a plan
    const planEvidence = !!trace.planWalls || trace.kinds[pv.page] === 'plan' || !trace.kinds.some((k) => k === 'plan' || k === 'elevation');
    // the importer's scale names the plan's model only when labels or dimensions gave it (a scale guessed from wall thickness names nothing)
    // (and the dimensions' own vote does not count: a model that named itself the plan's scale proves nothing)
    const scaleTrusted = result.extras.scale.votes.filter((x) => x.source !== 'dimension lines' && Math.abs(x.ptPerM / ptPerM - 1) <= 0.03).length >= 2;
    const atPlanScale = (sc: number): boolean => scaleTrusted && ptPerM > 0 && Math.abs(sc / ptPerM - 1) < 0.05;
    // The plan's own scale model: the one the room labels joined, else the one at the importer's scale.
    let planModel = pv.models.findIndex((m) => m.hasLabels);
    if (planModel < 0) planModel = pv.models.findIndex((m) => atPlanScale(m.fit.ptPerM));
    const elevOnPage = trace.reads[pv.page].some((r) => pageKindWords(r.str).some((k) => k === 'elevation' || k === 'section'));
    // a plan sheet with elevations on it and nothing to say which scale is the plan's cannot tell its dimensions apart
    // (and a lone sheet with nothing on it that says elevation is a plan sheet; anything else with no plan model is unclear)
    const loneSheet = trace.pages.length === 1 && !elevOnPage && pv.models.length <= 1;
    const noPlanModel = isPlanSheet && planModel < 0 && !loneSheet;
    const ambiguousSheet = isPlanSheet && (!planEvidence || noPlanModel);
    for (const v of pv.verdicts) {
      const d = v.dim;
      const mx = (d.a[0] + d.b[0]) / 2, my = (d.a[1] + d.b[1]) / 2;
      const padL = 2.2 * ptPerM, padR = 0.35 * ptPerM;
      const wp = trace.planWalls;
      const inPlanZone = roomsBox
        ? mx >= roomsBox[0] - padL && mx <= roomsBox[2] + padR && my >= roomsBox[1] - padL && my <= roomsBox[3] + padL
        : !!wp && mx >= wp[0] - 0.15 * (wp[2] - wp[0]) && mx <= wp[2] + 0.15 * (wp[2] - wp[0]) && my >= wp[1] - 0.15 * (wp[3] - wp[1]) && my <= wp[3] + 0.15 * (wp[3] - wp[1]);
      let role: 'plan' | 'elevation';
      let ambiguous = ambiguousSheet;
      if (!isPlanSheet) role = 'elevation';
      else if (ambiguousSheet) role = d.run.parsed.m >= 6 ? 'plan' : 'elevation';
      else if (planModel >= 0) {
        const ratio = v.model >= 0 ? Math.max(pv.models[v.model].fit.ptPerM, pv.models[planModel].fit.ptPerM) / Math.min(pv.models[v.model].fit.ptPerM, pv.models[planModel].fit.ptPerM) : 1;
        const atPlan = v.model === planModel || (v.model < 0 && scaleTrusted && ptPerM > 0 && Math.abs(d.lengthPt / ptPerM - d.run.parsed.m) <= Math.max(0.05 * d.run.parsed.m, 0.05));
        // an elevation drawn on the plan's sheet can share the plan's scale: then only where it sits tells them apart
        // (the captions that say so can be unread, so the position alone decides when the rooms are known)
        if ((elevOnPage || !!roomsBox) && atPlan && !inPlanZone) { role = 'elevation'; ambiguous = true; }
        else role = atPlan || (inPlanZone && v.model >= 0 && ratio <= 1.15) ? 'plan' : 'elevation';
      } else role = 'plan';
      if (ambiguous && v.status === 'verified') { v.status = 'unverified'; v.confidence = 0.4; v.message = 'the sheet holds a plan and an elevation and nothing tells which view this dimension is in'; demoted++; }
      pending.push({ d, v, role, page: pv.page, pv });
    }
  }
  // positions in metres: across the sheet at the scale of its horizontal plan dimensions, down it at the vertical ones' (a sheet
  // stretched along one axis has two); the importer's frame scale where a direction has no model of its own
  const planDimsPending = pending.filter((q) => q.role === 'plan' && q.v.model >= 0);
  // the plan's main scale: the model the most plan dimensions were judged by
  const mainScale = ((): number => {
    const count = new Map<number, number>();
    for (const q of planDimsPending) { const k = q.pv.models[q.v.model].fit.ptPerM; count.set(k, (count.get(k) ?? 0) + 1); }
    let best = 0, bn = 0;
    for (const [k, n] of count) if (n > bn) { bn = n; best = k; }
    return best;
  })();
  const axisScale = (vertical: boolean): number => {
    // each axis takes the median scale of the plan dimensions along it, among models within 15% of the main one (a sheet stretched
    // along one axis has a second model there; an elevation at another scale must not move the plan)
    const xs = planDimsPending.filter((q) => (q.d.angle > 45 && q.d.angle < 135) === vertical).map((q) => q.pv.models[q.v.model].fit.ptPerM).filter((k) => mainScale > 0 && Math.max(k, mainScale) / Math.min(k, mainScale) <= 1.15).sort((a, b) => a - b);
    return xs.length ? xs[xs.length >> 1] : mainScale || frameScale();
  };
  const sx = axisScale(false), sy = axisScale(true);
  for (const q of pending) {
    const w = (p: [number, number]): [number, number] => [(p[0] - cx) / (q.role === 'plan' ? sx : frameScale()), (p[1] - cy) / (q.role === 'plan' ? sy : frameScale())];
    out.push({ string: q.d.run.str, a: w(q.d.a), b: w(q.d.b), role: q.role, status: q.v.status, page: q.page, verdict: q.v });
  }
  if (demoted) warnings.push(`${demoted} dimension(s) were left unverified: the plan shares its sheet with an elevation and nothing says which scale is the plan's.`);
  // rooms: a label's sides and area against the traced polygon, measured at the scale the DIMENSIONS fit (labels never vouch for themselves)
  const roomStatus = new Map<string, Status>();
  const planPage = verdicts.find((p) => p.page === trace.planIdx);
  const planModel = planPage?.models.filter((m) => !m.notToScale).sort((x, y) => y.fit.inliers.length - x.fit.inliers.length)[0] ?? null;
  // an independent fit: the dimension pairs alone, so the room labels are not part of their own evidence
  const dimOnly = fitScale(all.filter((d) => d.page === trace.planIdx && !d.run.parts.some((p) => p.tentative) && (!walls || (((d.a[0] + d.b[0]) / 2 >= walls[0] - padW) && ((d.a[0] + d.b[0]) / 2 <= walls[2] + padW) && ((d.a[1] + d.b[1]) / 2 >= walls[1] - padW) && ((d.a[1] + d.b[1]) / 2 <= walls[3] + padW)))).map((d) => ({ id: d.id, lenPt: d.lengthPt, valueM: d.run.parsed.m, group: d.chain ?? d.id, source: 'dimension' as const })));
  const planDimsFit = dimOnly ?? null;
  void planModel;
  if (planDimsFit && !planDimsFit.notToScale && ptPerM) {
    for (const f of result.extras.rooms) {
      if (!f.labelDims || f.method === 'label-rect') continue;
      const room = result.proposal.rooms.find((x) => x.id === f.id);
      if (!room) continue;
      const k = ptPerM / planDimsFit.ptPerM; // metres at the dimension scale per metre at the importer's scale
      const xs = room.polygon.map((p) => p.x), zs = room.polygon.map((p) => p.z);
      const bw = (Math.max(...xs) - Math.min(...xs)) * k, bh = (Math.max(...zs) - Math.min(...zs)) * k;
      const lo = Math.min(f.labelDims.w, f.labelDims.l), hi = Math.max(f.labelDims.w, f.labelDims.l);
      const checks = [sideCheck(lo, Math.min(bw, bh)), sideCheck(hi, Math.max(bw, bh)), labelAreaCheck(lo * hi, bw * bh)];
      if (f.labelAreaM2) checks.push(labelAreaCheck(f.labelAreaM2, bw * bh));
      // an area label that disagrees with the size label (a printed 150 sq ft against 11'0"x12'6") is a conflict the broker sees
      roomStatus.set(f.id, checks.every((c) => c.ok) ? 'verified' : 'conflict');
    }
  }
  for (const pv of verdicts) for (const m of pv.models) if (m.notToScale) warnings.push(`Page ${pv.page + 1}: dimensions in one area do not agree on a scale. That part may not be drawn to scale.`);
  void extractDimension;
  return { dims: out, pages: verdicts, planFit: planDimsFit, roomStatus, warnings };
}
