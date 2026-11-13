// C12f. SPEC 17.14: constants shared by the browser and the server function. No env reading and no secrets here.

/** Drawn into the image pixels and shown under it (SPEC 16.2 rule 4 spirit, 17.14). */
export const PHOTO_LABEL = 'AI photo · illustrative, sizes not guaranteed';
export const FAIL_MESSAGE = 'Could not make a faithful photo of this view.';
export const PHOTO_ENDPOINT = '/api/photo';
/** At most this many taps per visit (the tab session). */
export const MAX_PER_VISIT = 3;
/** The frame and the guide are sent at this many pixels on the long side. */
export const SEND_LONG_SIDE = 1024;

/** Defaults from SPEC 17.14. Both ids are on Google's Gemini API model list and price table (checked 13 Nov 2026). */
export const DEFAULT_MODEL = 'gemini-nano-banana-2.1';
export const QUALITY_MODEL = 'gemini-3-pro-image';

/** Aspect ratios the image API accepts; the capture is cropped to the nearest one so the answer has the same framing. */
export const ASPECTS: { label: string; ratio: number }[] = [
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', '1:4', '4:1', '1:8', '8:1',
].map((label) => { const [a, b] = label.split(':').map(Number); return { label, ratio: a / b }; });

export function nearestAspect(w: number, h: number): { label: string; ratio: number } {
  const r = w / h;
  let best = ASPECTS[0];
  for (const a of ASPECTS) if (Math.abs(Math.log(a.ratio / r)) < Math.abs(Math.log(best.ratio / r))) best = a;
  return best;
}

/** The fixed prompt (SPEC 17.14). */
export const PHOTO_PROMPT =
  'Image 1 is a rendered view of a flat. Image 2 is a line drawing of the same view: white walls, dark lines for every wall edge and every furniture item. ' +
  'Make image 1 look like a real photograph of this room. Keep the exact room shape, the doors and windows, and the position and size of every piece of furniture, exactly as in both images. ' +
  'Do not add or remove furniture. Do not add people. Do not change the camera position, angle or framing. Keep the same aspect ratio.';

/** What the server tells the page. */
export interface PhotoStatus { enabled: boolean; configured: boolean; remainingToday?: number }
export interface PhotoRequest { frame: string; guide: string; frameMime: 'image/jpeg'; guideMime: 'image/png' | 'image/jpeg'; aspect: string }
export interface PhotoOk { ok: true; image: string; mime: string }
export interface PhotoErr { ok: false; error: 'disabled' | 'not-configured' | 'cap' | 'bad-request' | 'model' | 'no-image'; message: string }
export type PhotoResponse = PhotoOk | PhotoErr;
