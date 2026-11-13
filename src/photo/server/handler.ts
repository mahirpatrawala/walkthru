// C12f. SPEC 17.14: the photo endpoint's logic, independent of where it runs. The dev middleware (vite plugin) and the Vercel
// function (api/photo.ts) both call `handlePhoto`; neither the key nor this file is imported by anything the browser loads.
import { DEFAULT_MODEL } from '../config.js';
import type { PhotoErr, PhotoOk, PhotoStatus } from '../config.js';
import { PhotoModelError, callGemini } from './gemini.js';

export interface PhotoEnv { enabled: boolean; key: string | null; model: string; dailyCap: number }

const truthy = (v: string | undefined): boolean => !!v && !/^(0|false|no|off)$/i.test(v.trim());

/** `env` is process.env (or a stand-in); `key` is whatever the host read (a file in dev, WALKTHRU_GEMINI_KEY on Vercel). */
export function readPhotoEnv(env: Record<string, string | undefined>, key: string | null): PhotoEnv {
  const cap = Number(env.WALKTHRU_PHOTO_DAILY_CAP);
  return {
    enabled: truthy(env.WALKTHRU_PHOTO_ENABLED),
    key: key && key.trim() ? key.trim() : null,
    model: env.WALKTHRU_PHOTO_MODEL?.trim() || DEFAULT_MODEL,
    dailyCap: Number.isFinite(cap) && cap >= 0 && env.WALKTHRU_PHOTO_DAILY_CAP ? Math.floor(cap) : 50,
  };
}

/** Calls per UTC day, held in memory: on a serverless host that is per warm instance, so it is a best-effort ceiling. */
export interface DayCounter { take(cap: number, now?: Date): boolean; used(now?: Date): number }
export function createDayCounter(): DayCounter {
  let day = '';
  let n = 0;
  const roll = (now: Date): void => { const d = now.toISOString().slice(0, 10); if (d !== day) { day = d; n = 0; } };
  return {
    take(cap, now = new Date()) { roll(now); if (n >= cap) return false; n++; return true; },
    used(now = new Date()) { roll(now); return n; },
  };
}

export type Generate = (i: { model: string; frameB64: string; frameMime: string; guideB64: string; guideMime: string; aspect: string }) => Promise<{ data: string; mime: string }>;
export interface HandlerDeps { env: PhotoEnv; counter: DayCounter; generate?: Generate; fetchImpl?: typeof fetch; now?: () => Date }
export interface HandlerResult { status: number; body: PhotoOk | PhotoErr | PhotoStatus }

export const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_FIELD_B64 = 3 * 1024 * 1024;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

function magic(b64: string): 'jpeg' | 'png' | null {
  const head = Buffer.from(b64.slice(0, 16), 'base64');
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) return 'png';
  return null;
}

const err = (status: number, error: PhotoErr['error'], message: string): HandlerResult => ({ status, body: { ok: false, error, message } });

export function photoStatus(d: HandlerDeps): PhotoStatus {
  const remaining = Math.max(0, d.env.dailyCap - d.counter.used(d.now?.()));
  return { enabled: d.env.enabled, configured: !!d.env.key, remainingToday: d.env.enabled ? remaining : undefined };
}

export async function handlePhoto(method: string, bodyText: string | null, d: HandlerDeps): Promise<HandlerResult> {
  if (method === 'GET') return { status: 200, body: photoStatus(d) };
  if (method !== 'POST') return err(405, 'bad-request', 'Use GET or POST.');
  if (!d.env.enabled) return err(404, 'disabled', 'AI photo is switched off.');
  if (!d.env.key) return err(503, 'not-configured', 'AI photo is not configured on this server.');
  if (bodyText === null || bodyText.length > MAX_BODY_BYTES) return err(413, 'bad-request', 'The request is missing or too large.');
  let req: { frame?: unknown; guide?: unknown; frameMime?: unknown; guideMime?: unknown; aspect?: unknown };
  try { req = JSON.parse(bodyText); } catch { return err(400, 'bad-request', 'The request is not valid JSON.'); }
  const { frame, guide, aspect } = req;
  if (typeof frame !== 'string' || typeof guide !== 'string' || frame.length > MAX_FIELD_B64 || guide.length > MAX_FIELD_B64 || !B64.test(frame) || !B64.test(guide)) {
    return err(400, 'bad-request', 'The frame and the guide must be base64 images.');
  }
  const fm = magic(frame);
  const gm = magic(guide);
  if (fm !== 'jpeg' || !gm) return err(400, 'bad-request', 'The frame must be a JPEG and the guide a PNG or JPEG.');
  const asp = typeof aspect === 'string' ? aspect : '';
  if (!/^\d{1,2}:\d{1,2}$/.test(asp)) return err(400, 'bad-request', 'The aspect ratio is missing.');
  if (!d.counter.take(d.env.dailyCap, d.now?.())) return err(429, 'cap', 'AI photos are used up for today. The walk-through still has every size.');
  try {
    const gen: Generate = d.generate ?? ((i) => callGemini(d.env.key!, i, d.fetchImpl));
    const out = await gen({ model: d.env.model, frameB64: frame, frameMime: 'image/jpeg', guideB64: guide, guideMime: gm === 'png' ? 'image/png' : 'image/jpeg', aspect: asp });
    return { status: 200, body: { ok: true, image: out.data, mime: out.mime } };
  } catch (e) {
    if (e instanceof PhotoModelError) {
      // the detail goes to the host's log only, never to the page
      console.warn(`[walkthru] photo model: ${e.message}`);
      return e.kind === 'no-image' ? err(502, 'no-image', 'The model did not return a picture.') : err(502, 'model', 'The photo service did not answer.');
    }
    console.warn('[walkthru] photo handler failed');
    return err(500, 'model', 'The photo service did not answer.');
  }
}
