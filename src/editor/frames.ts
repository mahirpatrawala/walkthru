// Frame grabbing in the browser (SPEC 2.2 E1). Per the integrator, C5 implements this file; C6 only consumes the store.
// A dropped video gives one frame per second (at most 60) via a <video> element and a canvas; photos are added as they
// are. Frames live in memory only: nothing is uploaded or saved. Frames are downscaled to 720 px on the long side, which
// is the size of the reference WhatsApp video and keeps 60 frames near 90 MB instead of 220 MB.
// SPEC-GAP: 2.2 E1 gives no frame size; the 720 px cap is ours.
import type { FrameStore } from './context';

export const MAX_FRAMES_PER_VIDEO = 60;
export const MAX_FRAME_SIDE = 720;

/**
 * The timestamps to grab: one per second, in the middle of each second (so the first frame is not a black fade-in),
 * and never more than `max`; a longer video is sampled evenly instead. A clip under one second gives one frame.
 */
export function frameTimes(durationS: number, max: number = MAX_FRAMES_PER_VIDEO): number[] {
  if (!Number.isFinite(durationS) || durationS <= 0) return [0];
  const n = Math.min(max, Math.max(1, Math.floor(durationS)));
  const step = durationS / n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push((i + 0.5) * step);
  return out;
}

/** Size after scaling so the long side is at most `maxSide` (never upscales). */
export function fitSize(w: number, h: number, maxSide: number = MAX_FRAME_SIDE): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxSide) return { w, h };
  const k = maxSide / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

function drawScaled(src: CanvasImageSource, sw: number, sh: number): HTMLCanvasElement {
  const { w, h } = fitSize(sw, sh);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser could not make a canvas to read frames.');
  g.drawImage(src, 0, 0, w, h);
  return canvas;
}

function once(target: EventTarget, ok: string, bad: string, timeoutMs: number, what: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error(`${what} took too long.`)); }, timeoutMs);
    const onOk = (): void => { cleanup(); resolve(); };
    const onBad = (): void => { cleanup(); reject(new Error(`${what} failed.`)); };
    function cleanup(): void {
      clearTimeout(timer);
      target.removeEventListener(ok, onOk);
      target.removeEventListener(bad, onBad);
    }
    target.addEventListener(ok, onOk);
    target.addEventListener(bad, onBad);
  });
}

export function createFrameStore(): FrameStore {
  const frames: ImageBitmap[] = [];
  const listeners = new Set<() => void>();
  const notify = (): void => { for (const cb of [...listeners]) { try { cb(); } catch (err) { console.error('[walkthru] frame listener threw', err); } } };

  const store: FrameStore = {
    frames,
    onChange(cb) {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },

    async addVideo(file) {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      try {
        video.src = url;
        await once(video, 'loadedmetadata', 'error', 20000, 'Reading the video');
        if (!video.videoWidth || !video.videoHeight) throw new Error('The browser cannot decode this video. Try an MP4 (H.264).');
        const times = frameTimes(video.duration);
        for (const t of times) {
          const seeked = once(video, 'seeked', 'error', 8000, 'Seeking in the video');
          video.currentTime = Math.min(t, Math.max(0, (video.duration || t) - 0.05));
          await seeked;
          const canvas = drawScaled(video, video.videoWidth, video.videoHeight);
          frames.push(await createImageBitmap(canvas));
          notify();
        }
      } finally {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(url);
      }
    },

    async addImages(files) {
      let added = 0;
      for (const f of files) {
        try {
          const raw = await createImageBitmap(f);
          const canvas = drawScaled(raw, raw.width, raw.height);
          raw.close();
          frames.push(await createImageBitmap(canvas));
          added++;
          notify();
        } catch (err) {
          console.warn(`[walkthru] could not read image ${f.name}`, err);
        }
      }
      if (added === 0 && files.length > 0) {
        throw new Error(`Could not read ${files.length === 1 ? files[0].name : 'those images'}. Use JPG, PNG or WebP.`);
      }
    },
  };
  return store;
}
