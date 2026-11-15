// Clearance zones of a catalogue piece (src/core/pieces.ts): the space a swing needs to swing, a fridge door to open, a recliner to lie back,
// a WC to be used. Pure. The verdict goes through the same three words as every other check (fits, tight, blocked) and the words say which
// number was assumed. A swing's reach comes from the length of its chains, so a hung swing also asks the ceiling.
import { GRID_WALL_CM } from '../types';
import type { Box, CatalogItem, Grid, RoomType, Side, ZoneReading } from '../types';
import { cellValue } from './grid-codec';
import { clearance } from './grid-query';
import { sideEdge } from './geometry';
import { chainLengthM, swingReachM } from './pieces';
import type { PieceRule, Zone } from './pieces';

const RAY_START_M = 0.03;
const RAYS = [-0.8, -0.4, 0, 0.4, 0.8];
const DEFAULT_TIGHT_FRAC = 0.75;
const HOOK_NOTE = 'Hanging needs a structural hook: check with your builder.';
const CEILING_UNKNOWN_NOTE = 'The ceiling height is not confirmed, so the chain length is an estimate.';

const cm = (m: number): number => Math.round(m * 100);
const RAD = 180 / Math.PI;

export interface PieceVerdict {
  /** the worst of the zones, or null when the piece has none */
  verdict: 'fits' | 'tight' | 'blocked' | null;
  reason: 'ok' | 'access' | 'swing' | 'room';
  /** one sentence about the zones, starting with what the piece needs */
  sentence: string;
  readings: ZoneReading[];
  /** the sentence replaces the usual one-line fit message when the zones make the verdict worse */
  notes: string[];
}

/** How far a zone reaches beyond the side of a piece of this size, metres. A swing's reach follows its chains and the ceiling. */
export function zoneNeedM(z: Zone, spec: Pick<CatalogItem, 'footprint'>, side: Side, ceilingM: number): number {
  if (!z.swing) return z.needM;
  const L = chainLengthM(z, ceilingM);
  const half = side === 'front' || side === 'back' ? spec.footprint.d / 2 : spec.footprint.w / 2;
  const need = swingReachM(L, z.swing.angleDeg) + z.swing.seatHalfM - half;
  return Math.max(z.minNeedM ?? 0, Math.round(need * 100) / 100);
}

/** The seat-to-hook chain length a swing has under this ceiling (null for a piece that is not a swing). */
export function swingChainM(rule: PieceRule | null, ceilingM: number): number | null {
  const z = rule?.zones?.find((x) => !!x.swing);
  return z ? chainLengthM(z, ceilingM) : null;
}

function normalYawDeg(n: { x: number; z: number }): number {
  return ((Math.atan2(n.x, n.z) * RAD) + 360) % 360;
}

/** The first thing in the way along a ray: what it is, from the cell it stopped at. */
function obstacleAt(grid: Grid, origin: { x: number; z: number }, normal: { x: number; z: number }, dist: number): 'wall' | 'furniture' {
  const v = cellValue(grid, origin.x + normal.x * (dist + 0.03), origin.z + normal.z * (dist + 0.03));
  return v >= GRID_WALL_CM ? 'wall' : 'furniture';
}

/** Reads every zone of the piece against `grid` (which must exclude the piece itself). */
export function readZones(grid: Grid, spec: CatalogItem, rule: PieceRule, box: Box, ceilingM: number): ZoneReading[] {
  const out: ZoneReading[] = [];
  for (const z of rule.zones ?? []) {
    for (const side of z.sides) {
      const need = zoneNeedM(z, spec, side, ceilingM);
      const e = sideEdge(box, side);
      const width = z.widthM ?? e.half * 2;
      const cap = Math.max(3, need + 0.5);
      let have = cap;
      let hitFrom = { x: e.mid.x, z: e.mid.z };
      for (const f of RAYS) {
        const origin = {
          x: e.mid.x + e.along.x * f * (width / 2) + e.normal.x * RAY_START_M,
          z: e.mid.z + e.along.z * f * (width / 2) + e.normal.z * RAY_START_M,
        };
        const c = clearance(grid, origin, e.normal, cap);
        const d = c === 0 ? 0 : Math.min(cap, RAY_START_M + c);
        if (d < have) { have = d; hitFrom = origin; }
      }
      const tight = z.tightFrac ?? DEFAULT_TIGHT_FRAC;
      const ok = have >= need - 1e-9;
      const status: ZoneReading['status'] = ok ? 'ok' : have >= need * tight - 1e-9 ? 'tight' : 'blocked';
      out.push({
        zoneId: z.id, side, needM: need, haveM: have, status,
        obstacle: ok ? null : obstacleAt(grid, hitFrom, e.normal, Math.max(0, have - RAY_START_M)),
        box: { cx: e.mid.x + e.normal.x * (need / 2), cz: e.mid.z + e.normal.z * (need / 2), w: width, d: need, yawDeg: normalYawDeg(e.normal) },
      });
    }
  }
  return out;
}

function listOf(zones: Zone[], readings: ZoneReading[]): string {
  return zones.map((z, i) => {
    const r = readings.find((x) => x.zoneId === z.id);
    const n = cm(r?.needM ?? z.needM);
    return i === 0 ? `${n} cm clear ${z.where}` : `${n} cm ${z.where}`;
  }).join(' and ');
}

/** the zone sentence and the worst verdict of a piece, for the placement message. */
export function evaluatePiece(
  grid: Grid, spec: CatalogItem, rule: PieceRule | null, box: Box, ceilingM: number, ceilingKnown: boolean, roomType: RoomType | null,
  backClearanceM: number,
): PieceVerdict {
  const none: PieceVerdict = { verdict: null, reason: 'ok', sentence: '', readings: [], notes: [] };
  if (!rule) return none;
  const notes: string[] = [];
  let verdict: 'fits' | 'tight' | 'blocked' | null = null;
  let reason: PieceVerdict['reason'] = 'ok';
  let sentence = '';
  let readings: ZoneReading[] = [];

  const zones = rule.zones ?? [];
  const swingZ = zones.find((z) => !!z.swing);
  // a hung swing: the chains must have the length for a swing
  if (swingZ?.swing?.minCeilingM && ceilingM < swingZ.swing.minCeilingM - 1e-9 && swingZ.swing.hang === 'ceiling') {
    const L = chainLengthM(swingZ, ceilingM);
    verdict = 'blocked'; reason = 'swing';
    sentence = ceilingKnown
      ? `${spec.name} needs a ceiling of ${swingZ.swing.minCeilingM.toFixed(1)} m or more: at ${(Math.round(ceilingM * 100) / 100).toString()} m the chains would be only ${cm(L)} cm, too short to swing.`
      : `${spec.name} may not hang well: the ceiling height is not confirmed, and the chains need a ceiling of ${swingZ.swing.minCeilingM.toFixed(1)} m or more.`;
  } else if (zones.length > 0) {
    readings = readZones(grid, spec, rule, box, ceilingM);
    const rank = { ok: 0, tight: 1, blocked: 2 } as const;
    const worst = readings.reduce<ZoneReading | null>((m, r) => (!m || rank[r.status] > rank[m.status] ? r : m), null);
    verdict = !worst || worst.status === 'ok' ? 'fits' : worst.status === 'tight' ? 'tight' : 'blocked';
    reason = verdict === 'fits' ? 'ok' : swingZ ? 'swing' : 'access';
    const assume = [...new Set(zones.map((z) => z.assumption))];
    if (swingZ) {
      const L = chainLengthM(swingZ, ceilingM);
      assume[0] = `${swingZ.assumption}, chains ${cm(L)} cm long`;
    }
    const head = `${swingZ ? 'Swing' : spec.name} needs ${listOf(zones, readings)} (${assume.join('; ')})`;
    if (verdict === 'fits') sentence = `${head}. That space is clear.`;
    else {
      const bad = readings.filter((r) => r.status !== 'ok');
      const badText = bad.map((r) => `${cm(r.haveM)} cm ${spec.sideWords[r.side]}`).join(' and ');
      const z = zones.find((x) => x.id === (worst as ZoneReading).zoneId) as Zone;
      const obs = (worst as ZoneReading).obstacle === 'wall' ? 'the wall' : 'the furniture';
      const text = (verdict === 'blocked' ? z.blockedText : z.tightText).replace('{obs}', obs);
      sentence = `${head}: ${badText}, ${text}.`;
    }
  }

  if (rule.hung) {
    notes.push(HOOK_NOTE);
    if (!ceilingKnown) notes.push(CEILING_UNKNOWN_NOTE);
  }
  // a wall fixture touches a wall
  if (rule.wall && backClearanceM > 0.08 && verdict !== 'blocked') {
    verdict = 'tight';
    reason = reason === 'ok' ? 'access' : reason;
    notes.push(`${spec.name} is fixed to a wall, and the nearest one is ${cm(backClearanceM)} cm behind it.`);
  }
  // a fitting that belongs in one kind of room: allowed anywhere, with a clear message
  if (rule.rooms && roomType && !rule.rooms.includes(roomType) && verdict !== 'blocked') {
    verdict = 'tight';
    if (reason === 'ok') reason = 'room';
    notes.push(`${spec.name} ${rule.roomNote ?? 'is not usually put in this room.'}`);
  }
  return { verdict, reason, sentence, readings, notes };
}
