// People a buyer adds to a home (SPEC 2.1, 16.6.9). The record of one added person, and how it travels in the "My layout" link.
// Pure, and free of imports from the rest of the buyer page, so my-layout.ts (which store.ts imports) can use it without a cycle.
// People are never part of the home's data: they live in this viewer's layout only.

export type PersonBodyId = 'man' | 'woman' | 'elder' | 'child';
export type PersonPose = 'stand' | 'sit' | 'lie';

/** One added person. For `stand`, (x, z) is where they stand. For `sit` and `lie`, (x, z) is the spot the buyer tapped on `host`
 *  (the same "approach" the walker's own poses use), so the pose is recomputed from the piece's current box and follows it. */
export interface PersonRec {
  id: string;
  body: PersonBodyId;
  tone: number;
  heightCm: number;
  x: number;
  z: number;
  yawDeg: number;
  pose: PersonPose;
  /** the id of the sofa, bed or chair a sitting or lying person is on */
  host?: string;
}

export const REC_BODIES: readonly PersonBodyId[] = ['man', 'woman', 'elder', 'child'];
const POSES: readonly PersonPose[] = ['stand', 'sit', 'lie'];
/** the most people one layout can hold, whatever the device (the cap a device shows is lower on small ones: people/model.ts) */
export const PEOPLE_MAX = 5;
/** loose bounds: the exact range of each person is applied when they are made (people/model.ts) */
const H_MIN = 80, H_MAX = 230;
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A stored or decoded record, checked for type and sane numbers. Anything else is null. The id is the caller's. */
export function sanitizeRec(v: unknown, id: string): PersonRec | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (!REC_BODIES.includes(o.body as PersonBodyId) || !POSES.includes(o.pose as PersonPose)) return null;
  if (!isNum(o.x) || !isNum(o.z) || Math.abs(o.x) > 1000 || Math.abs(o.z) > 1000) return null;
  const rec: PersonRec = {
    id, body: o.body as PersonBodyId, pose: o.pose as PersonPose,
    tone: isNum(o.tone) ? Math.min(4, Math.max(0, Math.round(o.tone))) : 2,
    heightCm: isNum(o.heightCm) ? Math.min(H_MAX, Math.max(H_MIN, Math.round(o.heightCm))) : 170,
    x: o.x, z: o.z,
    yawDeg: isNum(o.yawDeg) ? ((o.yawDeg % 360) + 360) % 360 : 0,
  };
  if (rec.pose !== 'stand') {
    if (typeof o.host !== 'string' || !o.host || o.host.length > 120) return null;
    rec.host = o.host;
  }
  return rec;
}

/** Many records at once: invalid ones are dropped, ids are `pe-1`, `pe-2`... in order, and the list stops at PEOPLE_MAX. */
export function sanitizeRecs(list: unknown): PersonRec[] {
  if (!Array.isArray(list)) return [];
  const out: PersonRec[] = [];
  for (const v of list) {
    if (out.length >= PEOPLE_MAX) break;
    const r = sanitizeRec(v, `pe-${out.length + 1}`);
    if (r) out.push(r);
  }
  return out;
}

export function cloneRec(r: PersonRec): PersonRec {
  return { ...r };
}

// ---------------------------------------------------------------- the link

/**
 * One person on the wire: [body index, tone, height cm, x cm, z cm, yaw deg x10, pose index, host?]. The host of a person on a piece
 * the viewer added is `#n` (the n-th piece of the link's own `a` list, 1-based), because those pieces get new ids when a link is opened.
 */
export type WirePerson = [number, number, number, number, number, number, number, string?];

/** `hostRef` turns a record's host id into the string the link carries (an original's own id, or `#n`). Null drops the host (the person stands). */
export function peopleToWire(list: readonly PersonRec[], hostRef: (id: string) => string | null): WirePerson[] {
  const out: WirePerson[] = [];
  for (const r of list.slice(0, PEOPLE_MAX)) {
    let pose: PersonPose = r.pose;
    let ref: string | null = null;
    if (pose !== 'stand') {
      ref = r.host ? hostRef(r.host) : null;
      if (!ref) pose = 'stand';
    }
    const row: WirePerson = [REC_BODIES.indexOf(r.body), r.tone, r.heightCm, Math.round(r.x * 100), Math.round(r.z * 100), Math.round(r.yawDeg * 10), POSES.indexOf(pose)];
    if (pose !== 'stand' && ref) row.push(ref);
    out.push(row);
  }
  return out;
}

/** The people of a link. `resolveHost` maps the carried host string to an id in this home (null: no such piece, so the person stands). */
export function peopleFromWire(rows: unknown, resolveHost: (ref: string) => string | null): PersonRec[] {
  if (!Array.isArray(rows)) return [];
  const out: PersonRec[] = [];
  for (const row of rows) {
    if (out.length >= PEOPLE_MAX) break;
    if (!Array.isArray(row) || !isNum(row[0]) || !isNum(row[6])) continue;
    let pose = POSES[row[6]];
    let host: string | undefined;
    if (pose !== 'stand') {
      const id = typeof row[7] === 'string' ? resolveHost(row[7]) : null;
      if (id) host = id; else pose = 'stand';
    }
    const rec = sanitizeRec({ body: REC_BODIES[row[0]], tone: row[1], heightCm: row[2], x: isNum(row[3]) ? row[3] / 100 : NaN, z: isNum(row[4]) ? row[4] / 100 : NaN, yawDeg: isNum(row[5]) ? row[5] / 10 : 0, pose, host }, `pe-${out.length + 1}`);
    if (rec) out.push(rec);
  }
  return out;
}
