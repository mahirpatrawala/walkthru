// Owned by C10. SPEC 15.6 / 15.7: the one TypeScript adapter for the files the Python experiments write
// into public/scenes/<id>/ml/. Pure: types, validators and a path guard. No node imports, no fetch.
// Validators throw an Error with a readable message, the same style as C9's validatePinsFile.
import type { EdgeKind, LayoutProposal, Opening, OpeningType, RoomTag, RoomType, Vec2 } from '../types';

export const ML_DIR = 'ml';
/** Largest ML scale spread (IQR / median, percent) the app will apply (SPEC 15.7 acceptance 1). */
export const MAX_SCALE_SPREAD_PCT = 10;
/** The cap on a machine-made layout's confidence (SPEC 15.5 E4, 15.7). */
export const MAX_ML_CONFIDENCE = 0.4;

// ------------------------------------------------------------------ types for the files in 15.6
export interface MlReportEntry {
  id: string;
  variant?: string;
  model: string;
  licence: string;
  commercialOk: boolean;
  metrics: Record<string, number | null>;
  passed: boolean;
  minutes: number;
  peakMemoryGb: number | null;
  notes: string;
}
export interface MlReportFile { version: 1; generatedAt: string; experiments: MlReportEntry[] }

export interface MlRegistrationFile {
  version: 1;
  recipe: { extractorType: string; matcherType: string; extraArgs: string[] };
  largestFragmentFrames: number;
  fragments: number;
  totalFrames: number;
  commercialOk: boolean;
}

export interface MlScaleCheck { label: string; expectedM: number; measuredM: number }
export interface MlScaleFile {
  version: 1;
  model: string;
  licence: string;
  commercialOk: boolean;
  /** metres per unit of the splat's raw frame, the same meaning as SceneTransform.scale */
  metresPerUnit: number;
  spreadPct: number;
  frames: number;
  checks: MlScaleCheck[];
  crossCheck?: { model: string; metresPerUnit: number };
}

export interface MlCeilingFile {
  version: 1;
  model: string;
  licence: string;
  commercialOk: boolean;
  heightM: number;
  spreadPct: number;
  frames: number;
}

export interface MlFramesDropFile { version: 1; drop: string[] }

// ------------------------------------------------------------------ helpers
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

function fail(where: string, what: string): never {
  throw new Error(`ml/${where}: ${what}`);
}
function needObj(v: unknown, where: string): Record<string, unknown> {
  if (!isObj(v)) return fail(where, 'must be a JSON object');
  return v;
}
function needStr(o: Record<string, unknown>, key: string, where: string): string {
  const v = o[key];
  if (typeof v !== 'string' || v === '') return fail(`${where}.${key}`, 'must be non-empty text');
  return v;
}
function needNum(o: Record<string, unknown>, key: string, where: string, min = -Infinity): number {
  const v = o[key];
  if (!isNum(v)) return fail(`${where}.${key}`, 'must be a number');
  if (v < min) return fail(`${where}.${key}`, `must be at least ${min}`);
  return v;
}
function needBool(o: Record<string, unknown>, key: string, where: string): boolean {
  const v = o[key];
  if (typeof v !== 'boolean') return fail(`${where}.${key}`, 'must be true or false');
  return v;
}
function needVersion(o: Record<string, unknown>, where: string): void {
  if (o.version !== 1) fail(`${where}.version`, 'must be 1');
}

// ------------------------------------------------------------------ path guard
/**
 * True when `rel` (a path under the scene folder, '/' separators) is a file the app may read as a shipped ML output.
 * Anything under ml/experiments/ is never read (non-commercial yardstick outputs may live there), and `..` is refused.
 */
export function isShippableMlPath(rel: string): boolean {
  const p = rel.replace(/\\/g, '/');
  if (p.includes('..') || p.startsWith('/')) return false;
  if (!p.startsWith(`${ML_DIR}/`)) return false;
  if (p === `${ML_DIR}/experiments` || p.startsWith(`${ML_DIR}/experiments/`)) return false;
  return true;
}

// ------------------------------------------------------------------ validators
export function validateReport(json: unknown): MlReportFile {
  const o = needObj(json, 'report.json');
  needVersion(o, 'report.json');
  const generatedAt = needStr(o, 'generatedAt', 'report.json');
  if (!Array.isArray(o.experiments)) return fail('report.json.experiments', 'must be a list');
  const experiments = o.experiments.map((raw, i): MlReportEntry => {
    const w = `report.json.experiments[${i}]`;
    const e = needObj(raw, w);
    const metricsRaw = needObj(e.metrics, `${w}.metrics`);
    const metrics: Record<string, number | null> = {};
    for (const [k, v] of Object.entries(metricsRaw)) {
      if (v !== null && !isNum(v)) return fail(`${w}.metrics.${k}`, 'must be a number or null');
      metrics[k] = v;
    }
    const peak = e.peakMemoryGb;
    if (peak !== null && !isNum(peak)) fail(`${w}.peakMemoryGb`, 'must be a number or null');
    const out: MlReportEntry = {
      id: needStr(e, 'id', w), model: needStr(e, 'model', w), licence: needStr(e, 'licence', w),
      commercialOk: needBool(e, 'commercialOk', w), metrics, passed: needBool(e, 'passed', w),
      minutes: needNum(e, 'minutes', w, 0), peakMemoryGb: peak as number | null, notes: typeof e.notes === 'string' ? e.notes : '',
    };
    if (typeof e.variant === 'string') out.variant = e.variant;
    return out;
  });
  return { version: 1, generatedAt, experiments };
}

export function validateRegistration(json: unknown): MlRegistrationFile {
  const w = 'registration.json';
  const o = needObj(json, w);
  needVersion(o, w);
  const r = needObj(o.recipe, `${w}.recipe`);
  if (!Array.isArray(r.extraArgs) || !r.extraArgs.every((a) => typeof a === 'string')) fail(`${w}.recipe.extraArgs`, 'must be a list of text');
  return {
    version: 1,
    recipe: { extractorType: needStr(r, 'extractorType', `${w}.recipe`), matcherType: needStr(r, 'matcherType', `${w}.recipe`), extraArgs: r.extraArgs as string[] },
    largestFragmentFrames: needNum(o, 'largestFragmentFrames', w, 0),
    fragments: needNum(o, 'fragments', w, 0),
    totalFrames: needNum(o, 'totalFrames', w, 1),
    commercialOk: needBool(o, 'commercialOk', w),
  };
}

export function validateScale(json: unknown): MlScaleFile {
  const w = 'scale.json';
  const o = needObj(json, w);
  needVersion(o, w);
  const metresPerUnit = needNum(o, 'metresPerUnit', w);
  if (!(metresPerUnit > 0)) fail(`${w}.metresPerUnit`, 'must be above 0');
  if (!Array.isArray(o.checks)) return fail(`${w}.checks`, 'must be a list');
  const checks = o.checks.map((c, i): MlScaleCheck => {
    const cw = `${w}.checks[${i}]`;
    const co = needObj(c, cw);
    return { label: needStr(co, 'label', cw), expectedM: needNum(co, 'expectedM', cw), measuredM: needNum(co, 'measuredM', cw) };
  });
  const out: MlScaleFile = {
    version: 1, model: needStr(o, 'model', w), licence: needStr(o, 'licence', w), commercialOk: needBool(o, 'commercialOk', w),
    metresPerUnit, spreadPct: needNum(o, 'spreadPct', w, 0), frames: needNum(o, 'frames', w, 0), checks,
  };
  if (o.crossCheck !== undefined) {
    const cc = needObj(o.crossCheck, `${w}.crossCheck`);
    out.crossCheck = { model: needStr(cc, 'model', `${w}.crossCheck`), metresPerUnit: needNum(cc, 'metresPerUnit', `${w}.crossCheck`) };
  }
  return out;
}

export function validateCeiling(json: unknown): MlCeilingFile {
  const w = 'ceiling.json';
  const o = needObj(json, w);
  needVersion(o, w);
  const heightM = needNum(o, 'heightM', w);
  if (!(heightM > 0.5 && heightM < 10)) fail(`${w}.heightM`, 'must be between 0.5 and 10 metres');
  return {
    version: 1, model: needStr(o, 'model', w), licence: needStr(o, 'licence', w), commercialOk: needBool(o, 'commercialOk', w),
    heightM, spreadPct: needNum(o, 'spreadPct', w, 0), frames: needNum(o, 'frames', w, 0),
  };
}

export function validateFramesDrop(json: unknown): MlFramesDropFile {
  const w = 'frames-drop.json';
  const o = needObj(json, w);
  needVersion(o, w);
  if (!Array.isArray(o.drop) || !o.drop.every((s) => typeof s === 'string' && !s.includes('/') && !s.includes('..'))) {
    fail(`${w}.drop`, 'must be a list of file names');
  }
  return { version: 1, drop: o.drop as string[] };
}

const ROOM_TYPES: RoomType[] = ['bedroom', 'living', 'kitchen', 'bathroom', 'balcony', 'other'];
const EDGE_KINDS: EdgeKind[] = ['wall', 'railing', 'none'];
const OPENING_TYPES: OpeningType[] = ['door', 'opening', 'window'];

function parseVec2(v: unknown, where: string): Vec2 {
  const o = needObj(v, where);
  return { x: needNum(o, 'x', where), z: needNum(o, 'z', where) };
}

/** Parses the structure of a LayoutProposal (shape only; geometry is checked by proposalFromMl in apply.ts). */
export function validateProposalShape(json: unknown): LayoutProposal {
  const w = 'layout-proposal.json';
  const o = needObj(json, w);
  needVersion(o, w);
  const source = needStr(o, 'source', w);
  if (!Array.isArray(o.rooms)) return fail(`${w}.rooms`, 'must be a list');
  const rooms = o.rooms.map((raw, i): RoomTag => {
    const rw = `${w}.rooms[${i}]`;
    const r = needObj(raw, rw);
    if (!Array.isArray(r.polygon)) return fail(`${rw}.polygon`, 'must be a list');
    if (!Array.isArray(r.edges)) return fail(`${rw}.edges`, 'must be a list');
    const roomType = r.roomType;
    if (typeof roomType !== 'string' || !ROOM_TYPES.includes(roomType as RoomType)) return fail(`${rw}.roomType`, 'is not recognised');
    const edges = r.edges.map((e, k) => {
      if (typeof e !== 'string' || !EDGE_KINDS.includes(e as EdgeKind)) return fail(`${rw}.edges[${k}]`, 'is not recognised');
      return e as EdgeKind;
    });
    const room: RoomTag = {
      id: needStr(r, 'id', rw), roomType: roomType as RoomType, label: typeof r.label === 'string' ? r.label : String(r.id),
      polygon: r.polygon.map((p, k) => parseVec2(p, `${rw}.polygon[${k}]`)), edges,
    };
    if (typeof r.wallColor === 'string') room.wallColor = r.wallColor;
    if (typeof r.floorColor === 'string') room.floorColor = r.floorColor;
    return room;
  });
  const openingsRaw = o.openings ?? [];
  if (!Array.isArray(openingsRaw)) return fail(`${w}.openings`, 'must be a list');
  const openings = openingsRaw.map((raw, i): Opening => {
    const ow = `${w}.openings[${i}]`;
    const p = needObj(raw, ow);
    const type = p.type;
    if (typeof type !== 'string' || !OPENING_TYPES.includes(type as OpeningType)) return fail(`${ow}.type`, 'is not recognised');
    if (!Number.isInteger(p.edge)) return fail(`${ow}.edge`, 'must be a whole number');
    return {
      id: needStr(p, 'id', ow), roomId: needStr(p, 'roomId', ow), edge: p.edge as number, type: type as OpeningType,
      centreM: needNum(p, 'centreM', ow), widthM: needNum(p, 'widthM', ow, 0.01), sillM: needNum(p, 'sillM', ow, 0), headM: needNum(p, 'headM', ow, 0),
    };
  });
  const out: LayoutProposal = { version: 1, source, rooms, openings, confidence: needNum(o, 'confidence', w, 0) };
  if (o.wallHeightM !== undefined) out.wallHeightM = needNum(o, 'wallHeightM', w, 0.5);
  if (Array.isArray(o.notes)) out.notes = o.notes.filter((n): n is string => typeof n === 'string');
  return out;
}
