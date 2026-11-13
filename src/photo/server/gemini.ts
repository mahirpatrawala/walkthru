// C12f. SPEC 17.14: the image-model call, plain fetch, server side only. Google's current Gemini API serves its image models
// (gemini-nano-banana-2.1, gemini-3-pro-image) through the Interactions API: POST /v1beta/interactions with the key in the
// x-goog-api-key header. Request and response shapes are from Google's published OpenAPI document for that API
// (https://ai.google.dev/static/api/interactions-v1.openapi.json, read 13 Nov 2026): input is a list of text and image
// content blocks, `response_format` {type:'image'} picks size and aspect, the answer is a `model_output` step whose content
// holds an `image` block with base64 `data`.
import { PHOTO_PROMPT } from '../config.js';

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
/** The API revision header Google's docs send with these requests. */
export const API_REVISION = '2026-05-20';

export interface GeminiInput { model: string; frameB64: string; frameMime: string; guideB64: string; guideMime: string; aspect: string }

export function buildInteractionBody(i: GeminiInput): Record<string, unknown> {
  return {
    model: i.model,
    input: [
      { type: 'text', text: PHOTO_PROMPT },
      { type: 'image', mime_type: i.frameMime, data: i.frameB64 },
      { type: 'image', mime_type: i.guideMime, data: i.guideB64 },
    ],
    response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: i.aspect, image_size: '1K', delivery: 'inline' },
    // the request and the flat's views are not kept on Google's side for later retrieval
    store: false,
  };
}

export class PhotoModelError extends Error {
  constructor(readonly kind: 'model' | 'no-image', message: string) { super(message); }
}

/** The first image of the first model_output step, or null. */
export function extractImage(json: unknown): { data: string; mime: string } | null {
  const steps = (json as { steps?: unknown })?.steps;
  if (!Array.isArray(steps)) return null;
  for (const st of steps) {
    if (!st || (st as { type?: string }).type !== 'model_output') continue;
    const content = (st as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const c of content) {
      const b = c as { type?: string; data?: unknown; mime_type?: unknown };
      if (b?.type === 'image' && typeof b.data === 'string' && b.data.length > 0) return { data: b.data, mime: typeof b.mime_type === 'string' ? b.mime_type : 'image/jpeg' };
    }
  }
  return null;
}

/** Strips the key from any text before it is logged or returned. */
export function redact(text: string, key: string): string {
  return key ? text.split(key).join('[key]') : text;
}

export async function callGemini(key: string, i: GeminiInput, f: typeof fetch = fetch, timeoutMs = 55_000): Promise<{ data: string; mime: string }> {
  let res: Response;
  try {
    res = await f(`${GEMINI_BASE}/interactions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key, 'Api-Revision': API_REVISION },
      body: JSON.stringify(buildInteractionBody(i)),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new PhotoModelError('model', redact(`network: ${(e as Error).message}`, key));
  }
  const text = await res.text();
  if (!res.ok) throw new PhotoModelError('model', redact(`Gemini answered HTTP ${res.status}: ${text.slice(0, 200)}`, key));
  let json: unknown;
  try { json = JSON.parse(text); } catch { throw new PhotoModelError('model', 'Gemini answered with something that is not JSON.'); }
  const img = extractImage(json);
  if (!img) throw new PhotoModelError('no-image', 'The model returned no image.');
  return img;
}
