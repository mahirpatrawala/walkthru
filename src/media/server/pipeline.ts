// Owned by C9. SPEC 14.6: runMediaJob and the stages, in order. Node only.
import fs from 'node:fs';
import path from 'node:path';
import { validateProperty } from '../../core/layout-validate';
import { coverage as makeCoverage } from '../colmap-model';
import { selectEditorFrames } from '../frame-metrics';
import type { FrameMetric, ImageDescriptor } from '../frame-metrics';
import { isMatch, mergePins, nearestFrame, sanitiseFileName, suggestPinPose, validatePinsFile } from '../pins';
import type { FrameMatch } from '../pins';
import type {
  Coverage, FragmentInfo, FrameInfo, MediaManifest, MediaOptions, MediaResult, PhotoInfo, PhotoPin, PhotoPinsFile,
  ReconFragment, ReconHooks, ReconInput, ReconResult, ReconstructionBackend, StageId, StageState,
} from '../types';
import { getBackend } from './backend';
import { describeImageFile, encodeJpeg, extractReconFrames, grayMetrics, imageSize, probeMedia, reconFps } from './frames';
import type { MediaProbe } from './frames';

export const SCENE_ID_RE = /^[a-z0-9-]{1,40}$/;

export interface MediaPaths { root: string; scenesDir: string; cacheDir: string }
export function makePaths(root: string): MediaPaths {
  return { root, scenesDir: path.join(root, 'public/scenes'), cacheDir: path.join(root, '.cache/media') };
}

export interface MediaInput { path: string; kind: 'video' | 'photo'; originalName: string }

export interface PipelineConfig {
  /** wall-clock limit around the whole backend call (default: none, the backend's own timeouts govern). Tests use it. */
  backendTimeoutMs?: number;
  /** replace the backend that `options.backend` names */
  backend?: ReconstructionBackend | null;
}

export interface PipelineJob {
  jobId: string;
  sceneId: string;
  options: MediaOptions;
  inputs: MediaInput[];
  paths: MediaPaths;
  signal: AbortSignal;
  config?: PipelineConfig;
}

export interface PipelineHooks {
  stageStart(id: StageId, message?: string): void;
  progress(id: StageId, fraction: number, message?: string): void;
  stageEnd(id: StageId, state: StageState, message?: string): void;
  warning(message: string): void;
  log(message: string): void;
}

/** The media cannot be used: the job ends `failed` with this readable message. */
export class JobFailure extends Error {
  constructor(public readonly stage: StageId, message: string) { super(message); }
}
export class JobCancelled extends Error { constructor() { super('cancelled'); } }

export const DEFAULT_OPTIONS: MediaOptions = {
  mode: 'full', backend: 'local', trainExtraFragmentsMin: 0, patchProperty: false, skipTraining: false,
};

const BACKEND_STAGES = ['features', 'matching', 'mapping', 'select', 'training'] as const;
type BackendStage = (typeof BACKEND_STAGES)[number];

const TIMEOUTS = {
  probe: 20_000, frames: [180_000, 60_000], photos: 120_000, publish: 60_000,
} as const;

function throwIfAborted(signal: AbortSignal): void { if (signal.aborted) throw new JobCancelled(); }

/** Runs one job end to end. Resolves with the result (a missing splat is a normal outcome); throws JobFailure or JobCancelled. */
export async function runMediaJob(job: PipelineJob, hooks: PipelineHooks): Promise<MediaResult> {
  if (!SCENE_ID_RE.test(job.sceneId)) throw new JobFailure('probe', 'The scene name is not valid.');
  const { options, signal } = job;
  const sceneDir = path.join(job.paths.scenesDir, job.sceneId);
  const workDir = path.join(job.paths.cacheDir, job.sceneId, job.jobId);
  fs.mkdirSync(workDir, { recursive: true });
  const warnings: string[] = [];
  const warn = (m: string): void => { warnings.push(m); hooks.warning(m); };
  const toolCtx = { signal };

  // ------------------------------------------------------------------ probe
  hooks.stageStart('probe', 'Reading the files');
  const videos: { input: MediaInput; probe: MediaProbe }[] = [];
  const photoInputs: { input: MediaInput; probe: MediaProbe }[] = [];
  for (let i = 0; i < job.inputs.length; i++) {
    throwIfAborted(signal);
    const input = job.inputs[i];
    const probe = await probeMedia(input.path, TIMEOUTS.probe, toolCtx);
    throwIfAborted(signal);
    const label = sanitiseFileName(input.originalName);
    if (!probe.ok) { warn(`${label}: ${probe.error ?? 'could not be read'}.`); continue; }
    if (input.kind === 'video') {
      if (probe.durationSec <= 0) { warn(`${label}: no running time found, skipped.`); continue; }
      videos.push({ input, probe });
    } else {
      photoInputs.push({ input, probe });
    }
    hooks.progress('probe', (i + 1) / job.inputs.length);
  }
  if (videos.length === 0 && photoInputs.length === 0) {
    const msg = 'None of the files could be read as a video or a photo.';
    hooks.stageEnd('probe', 'failed', msg);
    throw new JobFailure('probe', msg);
  }
  hooks.stageEnd('probe', 'done', `${videos.length} video${videos.length === 1 ? '' : 's'}, ${photoInputs.length} photo${photoInputs.length === 1 ? '' : 's'}`);

  // ------------------------------------------------------------------ frames
  const mode = options.mode;
  const frameBudgetMs = mode === 'tiny' ? TIMEOUTS.frames[1] : TIMEOUTS.frames[0];
  const imagesDir = path.join(workDir, 'images');
  let longest: { input: MediaInput; probe: MediaProbe } | null = null;
  let fps = 0;
  let reconFrames: { file: string; timeSec: number }[] = [];
  let editorFrames: FrameInfo[] = [];
  const editorFrameFiles: string[] = [];
  if (videos.length === 0) {
    hooks.stageEnd('frames', 'skipped', 'No video.');
  } else {
    throwIfAborted(signal);
    hooks.stageStart('frames', 'Picking frames');
    longest = videos.reduce((a, b) => (b.probe.durationSec > a.probe.durationSec ? b : a));
    fps = reconFps(longest.probe.durationSec, mode);
    const started = Date.now();
    const left = (): number => Math.max(1000, frameBudgetMs - (Date.now() - started));
    try {
      const count = await extractReconFrames(longest.input.path, imagesDir, fps, mode, left(), toolCtx);
      throwIfAborted(signal);
      if (count === 0) throw new Error('No frames could be read from the video.');
      reconFrames = Array.from({ length: count }, (_, i) => ({ file: `frame-${String(i + 1).padStart(6, '0')}.jpg`, timeSec: i / fps }));
      hooks.progress('frames', 0.4);

      // editor frames from every video
      const metrics: { v: number; m: FrameMetric }[] = [];
      for (let vi = 0; vi < videos.length; vi++) {
        const v = videos[vi];
        const vfps = reconFps(v.probe.durationSec, 'full');
        try {
          const ms = await grayMetrics(v.input.path, v.probe.width, v.probe.height, vfps, left(), toolCtx);
          for (const m of selectEditorFrames(ms)) metrics.push({ v: vi, m });
        } catch (e) {
          if ((e as Error).message === 'aborted') throw new JobCancelled();
          warn(`Could not measure frames of ${sanitiseFileName(v.input.originalName)}.`);
        }
      }
      throwIfAborted(signal);
      let chosen = metrics;
      if (chosen.length > 60) {
        chosen = [...chosen].sort((a, b) => b.m.sharpness - a.m.sharpness).slice(0, 60)
          .sort((a, b) => a.v - b.v || a.m.timeSec - b.m.timeSec);
      }
      hooks.progress('frames', 0.6);
      const outDir = path.join(sceneDir, 'media/frames');
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });
      for (let k = 0; k < chosen.length; k++) {
        throwIfAborted(signal);
        const c = chosen[k];
        const name = `f-${String(k + 1).padStart(4, '0')}.jpg`;
        const out = path.join(outDir, name);
        const ok = await encodeJpeg(videos[c.v].input.path, out, { maxSide: 1280, q: 3, seekSec: c.m.timeSec }, left(), toolCtx);
        if (!ok) { warn(`Frame ${name} could not be written.`); continue; }
        const size = await imageSize(out);
        editorFrames.push({ file: `media/frames/${name}`, timeSec: Math.round(c.m.timeSec * 1000) / 1000, sharpness: Math.round(c.m.sharpness * 10) / 10,
          width: size?.width ?? 0, height: size?.height ?? 0 });
        editorFrameFiles.push(out);
        hooks.progress('frames', 0.6 + 0.4 * ((k + 1) / chosen.length));
      }
    } catch (e) {
      if (e instanceof JobCancelled || (e as Error).message === 'aborted') throw new JobCancelled();
      const msg = (e as Error).message || 'The video could not be read.';
      hooks.stageEnd('frames', 'failed', msg);
      throw new JobFailure('frames', msg);
    }
    hooks.stageEnd('frames', 'done', `${reconFrames.length} frames, ${editorFrames.length} kept for colour sampling`);
  }

  // ------------------------------------------------------------------ photos
  const photos: PhotoInfo[] = [];
  const photoMatches = new Map<string, FrameMatch | null>();
  const photoScores = new Map<string, number>();
  let photosError: string | null = null;
  if (photoInputs.length === 0) {
    hooks.stageEnd('photos', 'done', 'No photos.');
  } else {
    throwIfAborted(signal);
    hooks.stageStart('photos', 'Preparing photos');
    try {
      const outDir = path.join(sceneDir, 'media/photos');
      fs.rmSync(outDir, { recursive: true, force: true });
      fs.mkdirSync(outDir, { recursive: true });
      const deadline = Date.now() + TIMEOUTS.photos;
      const left = (): number => Math.max(1000, deadline - Date.now());
      const frameDescs: (ImageDescriptor | null)[] = [];
      for (const f of editorFrameFiles) frameDescs.push(await describeImageFile(f, toolCtx));
      for (let i = 0; i < photoInputs.length; i++) {
        throwIfAborted(signal);
        const pi = photoInputs[i];
        const id = `p-${String(photos.length + 1).padStart(3, '0')}`;
        const file = path.join(outDir, `${id}.jpg`);
        const thumb = path.join(outDir, `${id}.thumb.jpg`);
        const label = sanitiseFileName(pi.input.originalName);
        const ok = (await encodeJpeg(pi.input.path, file, { maxSide: 2048, q: 2 }, left(), toolCtx)) &&
          (await encodeJpeg(file, thumb, { maxSide: 320, q: 4 }, left(), toolCtx));
        if (!ok) { warn(`${label}: this photo could not be converted, skipped.`); continue; }
        const size = (await imageSize(file)) ?? { width: pi.probe.width, height: pi.probe.height };
        photos.push({ id, file: `media/photos/${id}.jpg`, thumb: `media/photos/${id}.thumb.jpg`, width: size.width, height: size.height, originalName: label });
        const desc = await describeImageFile(file, toolCtx);
        const usable = frameDescs.map((d, idx) => ({ d, idx })).filter((x): x is { d: ImageDescriptor; idx: number } => x.d !== null);
        const near = desc && usable.length ? nearestFrame(desc, usable.map((u) => u.d)) : null;
        if (near) {
          const fi = editorFrames[usable[near.index].idx];
          photoScores.set(id, near.score);
          photoMatches.set(id, isMatch(near.score) ? { frame: fi.file, timeSec: fi.timeSec, score: near.score } : null);
        } else {
          photoMatches.set(id, null);
        }
        hooks.progress('photos', (i + 1) / photoInputs.length);
      }
    } catch (e) {
      if (e instanceof JobCancelled || (e as Error).message === 'aborted') throw new JobCancelled();
      photosError = (e as Error).message;
      warn(`Photos could not be prepared: ${photosError}`);
    }
    if (photosError) hooks.stageEnd('photos', 'failed', photosError);
    else hooks.stageEnd('photos', photos.length === 0 ? 'failed' : 'done', `${photos.length} of ${photoInputs.length} photos ready`);
  }

  // ------------------------------------------------------------------ reconstruction (features .. training)
  let recon: ReconResult | null = null;
  let skipReason: string | null = null;
  let reconInputFrames = reconFrames;
  let ordered = true;
  let reconImagesDir = imagesDir;
  let reconTotal = reconFrames.length;
  let secondsTotal = Math.round((longest?.probe.durationSec ?? 0) * 1000) / 1000;
  const backend = job.config && 'backend' in job.config ? job.config.backend ?? null : getBackend(options.backend);
  const skipAll = (message: string): void => { for (const id of BACKEND_STAGES) hooks.stageEnd(id, 'skipped', message); };

  if (!longest && photos.length < 20) {
    skipReason = `Only ${photos.length} photo${photos.length === 1 ? '' : 's'}. A scan needs a video or at least 20 photos.`;
    skipAll(skipReason);
  } else if (!backend) {
    skipReason = 'Scan was turned off for this run.';
    skipAll(skipReason);
  } else {
    const avail = await backend.available();
    if (!avail.ok) {
      skipReason = `Scan tools not installed: ${avail.missing.join(', ')}`;
      skipAll(skipReason);
    } else {
      if (!longest) {
        // photo set: the normalised photos become the images
        ordered = false;
        reconImagesDir = imagesDir;
        fs.rmSync(imagesDir, { recursive: true, force: true });
        fs.mkdirSync(imagesDir, { recursive: true });
        reconInputFrames = photos.map((p, i) => {
          const name = `frame-${String(i + 1).padStart(6, '0')}.jpg`;
          fs.copyFileSync(path.join(sceneDir, p.file), path.join(imagesDir, name));
          return { file: name, timeSec: i };
        });
        reconTotal = photos.length;
        secondsTotal = 0;
      }
      throwIfAborted(signal);
      recon = await runBackend(job, backend, hooks, {
        workDir, imagesDir: reconImagesDir, frames: reconInputFrames, ordered, mode,
        trainExtraFragmentsMin: options.trainExtraFragmentsMin, skipTraining: options.skipTraining,
      }, warn);
    }
  }

  // ------------------------------------------------------------------ publish
  throwIfAborted(signal);
  hooks.stageStart('publish', 'Saving');
  const fragments: FragmentInfo[] = [];
  const published: { src: string; name: string }[] = [];
  const cov = (frag: ReconFragment): Coverage => {
    if (!ordered) {
      return { totalFrames: reconTotal, registeredFrames: frag.registered.length, secondsTotal: 0, secondsCovered: 0, spans: [] };
    }
    return makeCoverage(frag.registered.map((f) => f.timeSec), reconTotal, secondsTotal, fps);
  };
  if (recon) {
    recon.fragments.forEach((frag, i) => {
      let ply: string | null = null;
      if (frag.plyPath && fs.existsSync(frag.plyPath)) {
        ply = i === 0 ? 'scene.ply' : `scene-${i + 1}.ply`;
        published.push({ src: frag.plyPath, name: ply });
      }
      fragments.push({ index: i, registeredFrames: frag.registered.length, coverage: cov(frag), ply, splatCount: frag.splatCount, trainState: frag.trainState });
    });
    for (const w of recon.warnings) warn(w);
  }
  fs.mkdirSync(sceneDir, { recursive: true });
  for (const p of published) fs.copyFileSync(p.src, path.join(sceneDir, p.name));

  const frag0 = fragments[0];
  const hasSplat = !!frag0 && frag0.ply === 'scene.ply';
  const splat: MediaResult['splat'] = hasSplat
    ? { file: 'scene.ply', format: 'ply', upPreset: recon?.upPreset ?? 'flip-x', mode: 'overlay', transform: { rotation: [0, 0, 0, 1], scale: 1, position: [0, 0, 0] } }
    : null;
  const unit = ordered ? 'frames' : 'photos';
  let splatReason: string;
  if (hasSplat && frag0.trainState !== 'timeout') {
    const c = frag0.coverage;
    splatReason = ordered
      ? `Scan made from ${c.registeredFrames} of ${c.totalFrames} ${unit} (${c.secondsCovered.toFixed(1)} s of ${c.secondsTotal.toFixed(1)} s).`
      : `Scan made from ${c.registeredFrames} of ${c.totalFrames} ${unit}.`;
  } else if (hasSplat) {
    const c = frag0.coverage;
    splatReason = `Scan made from ${c.registeredFrames} of ${c.totalFrames} ${unit} (${c.secondsCovered.toFixed(1)} s of ${c.secondsTotal.toFixed(1)} s). Training ran out of time, so it is a rough version.`;
  } else if (skipReason) {
    splatReason = skipReason;
  } else if (!recon || fragments.length === 0) {
    splatReason = 'The video did not line up well enough for a scan. The room layout still works.';
  } else if (options.skipTraining) {
    // SPEC-GAP: 14.6 lists no reason for skipTraining; this says what happened in plain words.
    splatReason = `Scan training was skipped. ${frag0.registeredFrames} of ${frag0.coverage.totalFrames} ${unit} lined up.`;
  } else if (frag0.trainState === 'timeout') {
    splatReason = 'Scan training ran out of time.';
  } else if (frag0.trainState === 'skipped') {
    splatReason = 'Scan tools not installed: brush';
  } else {
    // SPEC-GAP: 14.6 lists no reason for a Brush failure.
    splatReason = 'Scan training did not finish. The room layout still works.';
  }

  const result: MediaResult = {
    frames: editorFrames, photos, splat, splatReason, fragments,
    cameras: recon?.fragments[0]?.cameras ?? [], warnings,
  };

  // photo pins
  if (photos.length > 0) {
    const fresh: PhotoPin[] = photos.map((p) => {
      const match = photoMatches.get(p.id) ?? null;
      const pin: PhotoPin = {
        id: p.id, file: p.file, thumb: p.thumb, width: p.width, height: p.height,
        at: null, yawDeg: null, roomId: null, placedBy: null,
      };
      const s = suggestPinPose(pin, match ?? (photoScores.has(p.id) ? { frame: '', timeSec: 0, score: photoScores.get(p.id)! } : null), result.cameras, null, null);
      pin.suggested = s;
      return pin;
    });
    const pinsPath = path.join(sceneDir, 'photo-pins.json');
    let existing: PhotoPinsFile = { version: 1, pins: [] };
    if (fs.existsSync(pinsPath)) {
      try { existing = validatePinsFile(JSON.parse(fs.readFileSync(pinsPath, 'utf8'))); } catch { warn('The old photo-pins.json could not be read, so it was replaced.'); }
    }
    fs.writeFileSync(pinsPath, JSON.stringify(mergePins(existing, fresh), null, 2) + '\n');
  }

  // manifest
  const manifest: MediaManifest = { version: 1, jobId: job.jobId, finishedAt: new Date().toISOString(), ...result };
  fs.mkdirSync(path.join(sceneDir, 'media'), { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'media/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  // property.json
  if (options.patchProperty && splat) {
    const propPath = path.join(sceneDir, 'property.json');
    if (fs.existsSync(propPath)) {
      try {
        const json = JSON.parse(fs.readFileSync(propPath, 'utf8')) as Record<string, unknown>;
        if (json.splat) {
          warn('property.json already has a scan, so it was left alone.');
        } else {
          json.splat = splat;
          validateProperty(json);
          fs.writeFileSync(propPath, JSON.stringify(json, null, 2) + '\n');
        }
      } catch (e) {
        warn(`property.json was not changed: ${(e as Error).message}`);
      }
    }
  }
  hooks.stageEnd('publish', 'done');
  // warnings added after the manifest was written (publish-time) are in `warnings` already (same array)
  return result;
}

/** Runs the backend with stage tracking, an optional wall-clock limit, and the "every stage ends" guarantee. */
async function runBackend(job: PipelineJob, backend: ReconstructionBackend, hooks: PipelineHooks,
  base: Omit<ReconInput, 'signal'>, warn: (m: string) => void): Promise<ReconResult> {
  const state = new Map<BackendStage, StageState>(BACKEND_STAGES.map((s) => [s, 'pending']));
  const ctl = new AbortController();
  const onAbort = (): void => ctl.abort();
  job.signal.addEventListener('abort', onAbort, { once: true });
  let closed = false; // after a timeout or an abort, late calls from the backend are ignored
  const end = (id: BackendStage, st: StageState, message?: string): void => { state.set(id, st); hooks.stageEnd(id, st, message); };
  const rh: ReconHooks = {
    stage(id, st, message) {
      if (closed) return;
      if (st === 'running') { state.set(id, 'running'); hooks.stageStart(id, message); }
      else if (st !== 'pending') end(id, st, message);
    },
    progress(id, fraction, message) { if (!closed) hooks.progress(id, Math.max(0, Math.min(1, fraction)), message); },
    log(line) { if (!closed) hooks.log(line); },
  };
  const limit = job.config?.backendTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const call = backend.reconstruct({ ...base, signal: ctl.signal }, rh);
    call.catch(() => { /* a late rejection after a timeout is expected */ });
    const guarded: Promise<ReconResult | 'timeout'> = limit
      ? Promise.race([call, new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), limit); })])
      : call;
    const out = await guarded;
    if (out === 'timeout') {
      closed = true;
      ctl.abort();
      const hit = BACKEND_STAGES.find((id) => state.get(id) === 'running') ?? BACKEND_STAGES.find((id) => state.get(id) === 'pending');
      for (const id of BACKEND_STAGES) {
        const st = state.get(id);
        if (id === hit) end(id, 'timeout', 'Ran out of time.');
        else if (st === 'pending' || st === 'running') end(id, 'skipped', 'Skipped after a time-out.');
      }
      warn('The scan ran out of time.');
      return { fragments: [], upPreset: 'flip-x', warnings: [] };
    }
    throwIfAborted(job.signal);
    return out;
  } catch (e) {
    closed = true;
    if (job.signal.aborted) throw new JobCancelled();
    const msg = (e as Error).message || 'The scan stages failed.';
    warn(`Scan failed: ${msg}`);
    for (const id of BACKEND_STAGES) {
      const st = state.get(id);
      if (st === 'running') end(id, 'failed', msg);
    }
    return { fragments: [], upPreset: 'flip-x', warnings: [] };
  } finally {
    if (timer) clearTimeout(timer);
    job.signal.removeEventListener('abort', onAbort);
    // the backend returned without closing a stage: a running one is done, a pending one is skipped
    for (const id of BACKEND_STAGES) {
      const st = state.get(id);
      if (st === 'running') end(id, 'done');
      else if (st === 'pending') end(id, 'skipped');
    }
  }
}
