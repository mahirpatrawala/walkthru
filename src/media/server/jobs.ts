// Owned by C9. SPEC 14.5: queue, job store, events. Node only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  JobEvent, JobState, JobStatus, MediaOptions, MediaResult, StageId, StageState, StageStatus, ReconstructionBackend,
} from '../types';
import { DEFAULT_OPTIONS, JobCancelled, JobFailure, SCENE_ID_RE, runMediaJob } from './pipeline';
import type { MediaInput, MediaPaths, PipelineConfig, PipelineHooks } from './pipeline';

export const STAGE_ORDER: StageId[] = ['probe', 'frames', 'photos', 'features', 'matching', 'mapping', 'select', 'training', 'publish'];
export const STAGE_WEIGHTS: Record<StageId, number> = {
  probe: 0.01, frames: 0.06, photos: 0.02, features: 0.12, matching: 0.14, mapping: 0.14, select: 0.01, training: 0.48, publish: 0.02,
};
export const MAX_EVENTS_PER_STATUS = 200;
const PROGRESS_THROTTLE_MS = 500;
const LOG_THROTTLE_MS = 1000;
const MAX_LOG_EVENTS = 300;
export const RESTART_ERROR = 'The dev server restarted. Run it again.';

const VIDEO_EXT = new Set(['mp4', 'mov', 'm4v', 'webm']);
const PHOTO_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic']);
export function kindFromName(name: string): 'video' | 'photo' | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';
  return VIDEO_EXT.has(ext) ? 'video' : PHOTO_EXT.has(ext) ? 'photo' : null;
}

export function newJobId(): string { return 'j-' + crypto.randomBytes(4).toString('hex'); }
export function newUploadId(): string { return 'u-' + crypto.randomBytes(4).toString('hex'); }
const isDone = (s: StageState): boolean => s === 'done' || s === 'skipped' || s === 'failed' || s === 'timeout';

/** Weighted progress: sum of weight times fraction, finished stages (any end state) count as complete. */
export function overallOf(stages: StageStatus[]): number {
  let sum = 0;
  for (const s of stages) sum += STAGE_WEIGHTS[s.id] * (isDone(s.state) ? 1 : s.fraction);
  return Math.min(1, Math.round(sum * 1e6) / 1e6);
}

/** One job's live status. Implements the hooks the pipeline reports to; every change is an event and is written to disk. */
export class JobRecord implements PipelineHooks {
  status: JobStatus;
  /** every event, never truncated; `status.events` is filled when a view is taken */
  private events: JobEvent[] = [];
  private lastProgress = new Map<StageId, number>();
  private lastLog = 0;
  private logCount = 0;
  readonly controller = new AbortController();
  readonly inputs: MediaInput[];

  constructor(readonly sceneId: string, readonly jobId: string, options: MediaOptions, inputs: MediaInput[], private readonly file: string) {
    const now = new Date().toISOString();
    this.inputs = inputs;
    this.status = {
      jobId, sceneId, state: 'queued', createdAt: now, updatedAt: now, options,
      stages: STAGE_ORDER.map((id) => ({ id, state: 'pending' as StageState, fraction: 0 })),
      overall: 0, events: [], lastSeq: 0, result: null,
    };
    this.push({ type: 'state', message: 'queued' });
  }

  private push(e: Omit<JobEvent, 'seq' | 'at'>): void {
    const at = new Date().toISOString();
    const ev: JobEvent = { seq: this.events.length + 1, at, ...e };
    this.events.push(ev);
    this.status.lastSeq = ev.seq;
    this.status.updatedAt = at;
    this.status.overall = overallOf(this.status.stages);
    this.persist();
  }

  private stage(id: StageId): StageStatus { return this.status.stages.find((s) => s.id === id)!; }

  setState(state: JobState, error?: string): void {
    this.status.state = state;
    if (error !== undefined) this.status.error = error;
    this.push({ type: 'state', message: state });
  }

  stageStart(id: StageId, message?: string): void {
    const s = this.stage(id);
    s.state = 'running'; s.fraction = 0; s.startedAt = new Date().toISOString();
    if (message) s.message = message;
    this.push({ type: 'stage-start', stage: id, stageState: 'running', message });
  }
  progress(id: StageId, fraction: number, message?: string): void {
    const s = this.stage(id);
    s.fraction = Math.max(0, Math.min(1, fraction));
    if (message) s.message = message;
    const now = Date.now();
    if (now - (this.lastProgress.get(id) ?? 0) < PROGRESS_THROTTLE_MS) return;
    this.lastProgress.set(id, now);
    this.push({ type: 'progress', stage: id, fraction: s.fraction, message });
  }
  stageEnd(id: StageId, state: StageState, message?: string): void {
    const s = this.stage(id);
    s.state = state; s.endedAt = new Date().toISOString();
    if (state === 'done') s.fraction = 1;
    if (message) s.message = message;
    this.push({ type: 'stage-end', stage: id, stageState: state, fraction: s.fraction, message });
  }
  warning(message: string): void { this.push({ type: 'warning', message }); }
  log(message: string): void {
    const now = Date.now();
    if (now - this.lastLog < LOG_THROTTLE_MS || this.logCount >= MAX_LOG_EVENTS) return;
    this.lastLog = now;
    this.logCount++;
    this.push({ type: 'log', message: message.slice(0, 300) });
  }

  /** Atomic write of the full status (all events). */
  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify({ ...this.status, events: this.events }));
      fs.renameSync(tmp, this.file);
    } catch { /* the store is best effort; the live status still works */ }
  }

  view(since = 0): JobStatus {
    const events = this.events.filter((e) => e.seq > since).slice(0, MAX_EVENTS_PER_STATUS);
    return { ...this.status, stages: this.status.stages.map((s) => ({ ...s })), events };
  }
}

export interface ManagerConfig {
  paths: MediaPaths;
  pipeline?: PipelineConfig;
  /** test hook: pick a backend instance by name instead of the registry */
  backendFor?: (name: MediaOptions['backend']) => ReconstructionBackend | null;
}

export class JobManager {
  private records = new Map<string, JobRecord>();
  private queue: JobRecord[] = [];
  private running: JobRecord | null = null;
  private idleWaiters: (() => void)[] = [];

  constructor(readonly cfg: ManagerConfig) {}

  private storeFile(sceneId: string, jobId: string): string { return path.join(this.cfg.paths.cacheDir, sceneId, 'jobs', `${jobId}.json`); }
  uploadsDir(sceneId: string): string { return path.join(this.cfg.paths.cacheDir, sceneId, 'uploads'); }

  /** Finds a stored upload by id. */
  resolveUpload(sceneId: string, uploadId: string): MediaInput | null {
    if (!/^u-[0-9a-f]{8}$/.test(uploadId)) return null;
    const dir = this.uploadsDir(sceneId);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return null; }
    const hit = names.find((n) => n.startsWith(uploadId + '-'));
    if (!hit) return null;
    const kind = kindFromName(hit);
    if (!kind) return null;
    return { path: path.join(dir, hit), kind, originalName: hit.slice(uploadId.length + 1) };
  }

  /** Marks stored jobs that were queued or running when the server stopped as failed. Returns how many. */
  recover(): number {
    let n = 0;
    let scenes: string[] = [];
    try { scenes = fs.readdirSync(this.cfg.paths.cacheDir); } catch { return 0; }
    for (const sc of scenes) {
      const dir = path.join(this.cfg.paths.cacheDir, sc, 'jobs');
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          const st = JSON.parse(fs.readFileSync(p, 'utf8')) as JobStatus & { events: JobEvent[] };
          if (st.state !== 'queued' && st.state !== 'running') continue;
          const at = new Date().toISOString();
          st.state = 'failed';
          st.error = RESTART_ERROR;
          st.updatedAt = at;
          const seq = (st.events.at(-1)?.seq ?? 0) + 1;
          st.events.push({ seq, at, type: 'state', message: 'failed' });
          st.lastSeq = seq;
          fs.writeFileSync(p, JSON.stringify(st));
          n++;
        } catch { /* unreadable store file: leave it */ }
      }
    }
    return n;
  }

  /** Queues a job. Resolves immediately with its status; it runs when the one before it ends. */
  create(sceneId: string, inputs: MediaInput[], options?: Partial<MediaOptions>): JobStatus {
    if (!SCENE_ID_RE.test(sceneId)) throw new Error('bad scene id');
    const opts: MediaOptions = { ...DEFAULT_OPTIONS, ...(options ?? {}) };
    const jobId = newJobId();
    const rec = new JobRecord(sceneId, jobId, opts, inputs, this.storeFile(sceneId, jobId));
    this.records.set(`${sceneId}/${jobId}`, rec);
    this.queue.push(rec);
    queueMicrotask(() => this.pump());
    return rec.view(0);
  }

  get(sceneId: string, jobId: string, since = 0): JobStatus | null {
    const rec = this.records.get(`${sceneId}/${jobId}`);
    if (rec) return rec.view(since);
    if (!SCENE_ID_RE.test(sceneId) || !/^j-[0-9a-f]{8}$/.test(jobId)) return null;
    try {
      const st = JSON.parse(fs.readFileSync(this.storeFile(sceneId, jobId), 'utf8')) as JobStatus;
      st.events = st.events.filter((e) => e.seq > since).slice(0, MAX_EVENTS_PER_STATUS);
      return st;
    } catch {
      return null;
    }
  }

  list(sceneId: string): { jobId: string; state: JobState; createdAt: string }[] {
    const out = new Map<string, { jobId: string; state: JobState; createdAt: string }>();
    const dir = path.join(this.cfg.paths.cacheDir, sceneId, 'jobs');
    let files: string[] = [];
    try { files = fs.readdirSync(dir).filter((f) => /^j-[0-9a-f]{8}\.json$/.test(f)); } catch { /* none yet */ }
    for (const f of files) {
      try {
        const st = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as JobStatus;
        out.set(st.jobId, { jobId: st.jobId, state: st.state, createdAt: st.createdAt });
      } catch { /* skip */ }
    }
    for (const rec of this.records.values()) {
      if (rec.sceneId === sceneId) out.set(rec.jobId, { jobId: rec.jobId, state: rec.status.state, createdAt: rec.status.createdAt });
    }
    return [...out.values()].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : b.jobId.localeCompare(a.jobId)));
  }

  /** Cancels a queued or running job. False when the job is unknown or already over. */
  cancel(sceneId: string, jobId: string): boolean {
    const rec = this.records.get(`${sceneId}/${jobId}`);
    if (!rec) return false;
    const s = rec.status.state;
    if (s === 'queued') {
      this.queue = this.queue.filter((r) => r !== rec);
      rec.controller.abort();
      rec.setState('cancelled');
      this.checkIdle();
      return true;
    }
    if (s === 'running') { rec.controller.abort(); return true; }
    return false;
  }

  /** Resolves when nothing is queued or running. */
  idle(): Promise<void> {
    if (!this.running && this.queue.length === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
  private checkIdle(): void {
    if (this.running || this.queue.length > 0) return;
    for (const w of this.idleWaiters.splice(0)) w();
  }

  private pump(): void {
    if (this.running) return;
    const rec = this.queue.shift();
    if (!rec) { this.checkIdle(); return; }
    this.running = rec;
    void this.execute(rec).finally(() => {
      this.running = null;
      this.pump();
    });
  }

  private async execute(rec: JobRecord): Promise<void> {
    rec.setState('running');
    // older work directories of this scene go
    const sceneCache = path.join(this.cfg.paths.cacheDir, rec.sceneId);
    try {
      for (const d of fs.readdirSync(sceneCache)) {
        if (/^j-[0-9a-f]{8}$/.test(d) && d !== rec.jobId) fs.rmSync(path.join(sceneCache, d), { recursive: true, force: true });
      }
    } catch { /* nothing to clean */ }
    const config: PipelineConfig = { ...(this.cfg.pipeline ?? {}) };
    if (this.cfg.backendFor && !('backend' in config)) config.backend = this.cfg.backendFor(rec.status.options.backend);
    try {
      const result: MediaResult = await runMediaJob({
        jobId: rec.jobId, sceneId: rec.sceneId, options: rec.status.options, inputs: rec.inputs,
        paths: this.cfg.paths, signal: rec.controller.signal, config,
      }, rec);
      if (rec.controller.signal.aborted) { rec.setState('cancelled'); return; }
      rec.status.result = result;
      rec.setState('done');
    } catch (e) {
      if (e instanceof JobCancelled || rec.controller.signal.aborted) { rec.setState('cancelled'); return; }
      const msg = e instanceof JobFailure ? e.message : `Something went wrong: ${(e as Error).message}`;
      rec.setState('failed', msg);
    }
  }
}
