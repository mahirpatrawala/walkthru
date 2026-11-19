// The inventory endpoint's logic (SPEC 22.3), independent of where it runs: the Vercel function (api/inventory.ts) and the dev middleware both call
// `handleInventory`. GET is public and short-cached; POST needs the admin passcode in a header, compared in constant time against the server's own
// WALKTHRU_ADMIN_PASSCODE. With that variable unset every write answers "admin not configured": there is no default passcode and none in this file.
// Building and unit ids are checked against the building's own unit list; anything else is refused. Server side only.
import crypto from 'node:crypto';
import { ADMIN_HEADER, isStatus } from '../types.js';
import type { InventoryChanged, InventoryErr, InventoryErrorCode, InventoryOk } from '../types.js';
import type { InventoryStore } from './store.js';

export interface InventoryRequest {
  method: string;
  /** the query string, without the `?` */
  search: string;
  /** header names in lower case */
  headers: Record<string, string | undefined>;
  /** the raw body of a POST; null when it was too large or unreadable */
  body: string | null;
  /** who is asking (for the failure throttle): the forwarded address, else the socket's */
  client?: string;
}

export interface InventoryResponse { status: number; body: InventoryOk | InventoryChanged | InventoryErr; headers?: Record<string, string> }

export interface FailureThrottle { blocked(key: string, now: number): boolean; fail(key: string, now: number): void; reset(key: string): void }
/** Wrong passcodes from one client: five in a minute and the next minute of attempts is refused. Per warm instance, so a best effort, not a guarantee. */
export function createFailureThrottle(max = 5, windowMs = 60_000): FailureThrottle {
  const m = new Map<string, number[]>();
  const live = (key: string, now: number): number[] => { const l = (m.get(key) ?? []).filter((t) => now - t < windowMs); m.set(key, l); return l; };
  return {
    blocked: (key, now) => live(key, now).length >= max,
    fail: (key, now) => { live(key, now).push(now); if (m.size > 500) for (const [k, v] of m) if (!v.some((t) => now - t < windowMs)) m.delete(k); },
    reset: (key) => { m.delete(key); },
  };
}

export interface InventoryDeps {
  /** null: no database is configured on this server */
  store: InventoryStore | null;
  /** WALKTHRU_ADMIN_PASSCODE, or null/empty when it is not set */
  passcode: string | null;
  /** the building's own unit ids, or null when there is no such building (or it has no units) */
  unitsOf(building: string): Promise<string[] | null>;
  throttle?: FailureThrottle;
  now?: () => number;
}

/** the same rule as the building's id (src/building/parse.ts, which a test holds this to); written out here so the function pulls in no more of the app than it must */
export const BUILDING_ID_RE = /^[a-z0-9-]{1,40}$/;
export const MAX_BODY_BYTES = 2048;
const SHARED_THROTTLE = createFailureThrottle();

const fail = (status: number, error: InventoryErrorCode, message: string, headers?: Record<string, string>): InventoryResponse => ({ status, body: { ok: false, error, message }, headers: { 'cache-control': 'no-store', ...headers } });

/** Compares two secrets without leaking where they differ or how long the real one is: both are hashed to the same length first. */
export function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

export async function handleInventory(req: InventoryRequest, d: InventoryDeps): Promise<InventoryResponse> {
  try {
    if (req.method === 'GET') return await read(req, d);
    if (req.method === 'POST') return await write(req, d);
    return fail(405, 'method-not-allowed', 'Use GET or POST.', { allow: 'GET, POST' });
  } catch (err) {
    console.error('[inventory] failed', err instanceof Error ? err.message : 'unknown error'); // the message only: never the connection string
    return fail(500, 'server-error', 'The inventory could not be reached.');
  }
}

async function read(req: InventoryRequest, d: InventoryDeps): Promise<InventoryResponse> {
  const building = new URLSearchParams(req.search).get('building') ?? '';
  if (!BUILDING_ID_RE.test(building)) return fail(400, 'bad-request', 'Name a building: ?building=<id>.');
  const ids = await d.unitsOf(building);
  if (!ids) return fail(404, 'unknown-building', 'There is no building with units by that id.');
  if (!d.store) return fail(503, 'not-configured', 'The inventory database is not configured on this server.');
  const got = await d.store.read(building);
  const known = new Set(ids);
  const units: InventoryOk['units'] = {};
  for (const [id, status] of Object.entries(got.units)) if (known.has(id)) units[id] = status; // a stray row for a unit the building does not have is not shown
  return {
    status: 200,
    body: { ok: true, building, units, settings: got.settings },
    headers: { 'cache-control': 'public, max-age=0, s-maxage=15, stale-while-revalidate=30' },
  };
}

async function write(req: InventoryRequest, d: InventoryDeps): Promise<InventoryResponse> {
  // 1. nothing is writable until the owner has set a passcode
  if (!d.passcode) return fail(503, 'admin-not-configured', 'Admin is not configured on this server: no passcode is set, so nothing can be changed.');
  // 2. the passcode, from a header only (never the address), compared in constant time, with a throttle on wrong ones
  const now = (d.now ?? Date.now)();
  const key = req.client || 'unknown';
  const throttle = d.throttle ?? SHARED_THROTTLE;
  if (throttle.blocked(key, now)) return fail(429, 'rate-limited', 'Too many wrong passcodes. Wait a minute and try again.', { 'retry-after': '60' });
  const given = req.headers[ADMIN_HEADER];
  if (typeof given !== 'string' || given.length === 0 || given.length > 200 || !safeEqual(given, d.passcode)) {
    throttle.fail(key, now);
    return fail(401, 'unauthorized', 'The passcode is missing or wrong.');
  }
  throttle.reset(key);
  // 3. the change
  if (req.body === null || Buffer.byteLength(req.body, 'utf8') > MAX_BODY_BYTES) return fail(400, 'bad-request', 'The request body is missing or too large.');
  let json: unknown;
  try { json = JSON.parse(req.body); } catch { return fail(400, 'bad-request', 'The request body is not valid JSON.'); }
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return fail(400, 'bad-request', 'The request body must be a JSON object.');
  const o = json as Record<string, unknown>;
  const allowed = new Set(['building', 'unit', 'status', 'vastuEnabled', 'check']);
  for (const k of Object.keys(o)) if (!allowed.has(k)) return fail(400, 'bad-request', `Unknown field "${k}".`);
  const building = o.building;
  if (typeof building !== 'string' || !BUILDING_ID_RE.test(building)) return fail(400, 'bad-request', 'building must be a building id.');
  const ids = await d.unitsOf(building);
  if (!ids) return fail(404, 'unknown-building', 'There is no building with units by that id.');
  // `{building, check: true}` changes nothing: it lets the admin page learn that the passcode is right before anyone edits
  if (o.check !== undefined) {
    if (o.check === true && Object.keys(o).length === 2) return { status: 200, body: { ok: true, building, changed: false }, headers: { 'cache-control': 'no-store' } };
    return fail(400, 'bad-request', 'A check is {building, check: true} on its own.');
  }
  const wantsUnit = o.unit !== undefined || o.status !== undefined, wantsVastu = o.vastuEnabled !== undefined;
  if (wantsUnit === wantsVastu) return fail(400, 'bad-request', 'Send either {unit, status} or {vastuEnabled}, one change at a time.');
  if (!d.store) return fail(503, 'not-configured', 'The inventory database is not configured on this server.');
  const noStore = { 'cache-control': 'no-store' };
  if (wantsVastu) {
    if (typeof o.vastuEnabled !== 'boolean') return fail(400, 'bad-request', 'vastuEnabled must be true or false.');
    await d.store.setVastu(building, o.vastuEnabled);
    return { status: 200, body: { ok: true, building, changed: true, vastuEnabled: o.vastuEnabled }, headers: noStore };
  }
  if (typeof o.unit !== 'string' || !ids.includes(o.unit)) return fail(400, 'unknown-unit', 'That unit is not one of this building\'s units.');
  if (!isStatus(o.status)) return fail(400, 'bad-request', 'status must be "available" or "sold".');
  const changed = await d.store.setStatus(building, o.unit, o.status);
  return { status: 200, body: { ok: true, building, changed, unit: o.unit, status: o.status }, headers: noStore };
}
