// C12e. SPEC 17.9 server side and 17.13 "the pipeline is a queue job like C9's": one job at a time per server, stages with progress,
// events a page can poll with `since`, the status written to disk after every change. Same shape as src/media/server/jobs.ts,
// smaller because the pipeline has four stages. Node only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { UnderstandPaths } from './store';
import { SCENE_ID_RE, sceneCache } from './store';

export type StageId = 'read' | 'render' | 'understand' | 'write';
export type StageState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export const STAGES: { id: StageId; label: string; weight: number }[] = [
  { id: 'read', label: 'Reading the files', weight: 0.1 },
  { id: 'render', label: 'Making page pictures', weight: 0.2 },
  { id: 'understand', label: 'Reading the drawing', weight: 0.6 },
  { id: 'write', label: 'Saving the results', weight: 0.1 },
];
export const RESTART_ERROR = 'The dev server restarted. Run it again.';
export interface StageStatus { id: StageId; label: string; state: StageState; fraction: number; message?: string }
export interface JobEvent { seq: number; at: string; type: 'state' | 'stage-start' | 'progress' | 'stage-end' | 'warning'; stage?: StageId; message?: string; fraction?: number }
export interface UnderstandOptions { /** the broker asked for the vision model AND ticked the notice */ vision: boolean }
export interface UnderstandSummary {
  path: 'vector' | 'picture';
  pages: number; rooms: number; openings: number; items: number; dimensions: number;
  verified: number; needLook: number; conflicts: number;
  vision: { used: boolean; calls: number; usd: number };
}
export interface JobStatus {
  jobId: string; sceneId: string; state: JobState; createdAt: string; updatedAt: string;
  options: UnderstandOptions; files: number;
  stages: StageStatus[]; overall: number; events: JobEvent[]; lastSeq: number;
  error?: string; result: UnderstandSummary | null;
}
export interface UnderstandHooks {
  stageStart(id: StageId, message?: string): void;
  progress(id: StageId, fraction: number, message?: string): void;
  stageEnd(id: StageId, state: StageState, message?: string): void;
  warning(message: string): void;
}
export interface UnderstandInput { path: string; kind: 'pdf' | 'image'; bytes: number }
export interface UnderstandJob { jobId: string; sceneId: string; options: UnderstandOptions; inputs: UnderstandInput[]; paths: UnderstandPaths; signal: AbortSignal }
export type JobRunner = (job: UnderstandJob, hooks: UnderstandHooks) => Promise<UnderstandSummary>;
/** A failure with words a broker can act on. */
export class JobFailure extends Error {}
export class JobCancelled extends Error { constructor() { super('cancelled'); } }

export const newJobId = (): string => 'j-' + crypto.randomBytes(4).toString('hex');
export const newUploadId = (): string => 'u-' + crypto.randomBytes(4).toString('hex');
const PROGRESS_MS = 400;

export function overallOf(stages: StageStatus[]): number {
  let sum = 0;
  for (const s of stages) {
    const w = STAGES.find((x) => x.id === s.id)!.weight;
    sum += w * (s.state === 'done' || s.state === 'skipped' || s.state === 'failed' ? 1 : s.fraction);
  }
  return Math.min(1, Math.round(sum * 1e6) / 1e6);
}

class JobRecord implements UnderstandHooks {
  status: JobStatus;
  private events: JobEvent[] = [];
  private last = new Map<StageId, number>();
  readonly controller = new AbortController();
  constructor(readonly sceneId: string, readonly jobId: string, readonly inputs: UnderstandInput[], options: UnderstandOptions, private readonly fileName: string) {
    const now = new Date().toISOString();
    this.status = { jobId, sceneId, state: 'queued', createdAt: now, updatedAt: now, options, files: inputs.length, stages: STAGES.map((s) => ({ id: s.id, label: s.label, state: 'pending' as StageState, fraction: 0 })), overall: 0, events: [], lastSeq: 0, result: null };
    this.push({ type: 'state', message: 'queued' });
  }
  private push(e: Omit<JobEvent, 'seq' | 'at'>): void {
    const at = new Date().toISOString();
    const ev: JobEvent = { seq: this.events.length + 1, at, ...e };
    this.events.push(ev);
    this.status.lastSeq = ev.seq; this.status.updatedAt = at; this.status.overall = overallOf(this.status.stages);
    this.persist();
  }
  private stage(id: StageId): StageStatus { return this.status.stages.find((s) => s.id === id)!; }
  setState(state: JobState, error?: string): void { this.status.state = state; if (error !== undefined) this.status.error = error; this.push({ type: 'state', message: state }); }
  stageStart(id: StageId, message?: string): void { const s = this.stage(id); s.state = 'running'; s.fraction = 0; if (message) s.message = message; this.push({ type: 'stage-start', stage: id, message }); }
  progress(id: StageId, fraction: number, message?: string): void {
    const s = this.stage(id); s.fraction = Math.max(0, Math.min(1, fraction)); if (message) s.message = message;
    const now = Date.now();
    if (now - (this.last.get(id) ?? 0) < PROGRESS_MS) return;
    this.last.set(id, now);
    this.push({ type: 'progress', stage: id, fraction: s.fraction, message });
  }
  stageEnd(id: StageId, state: StageState, message?: string): void { const s = this.stage(id); s.state = state; if (state === 'done') s.fraction = 1; if (message) s.message = message; this.push({ type: 'stage-end', stage: id, message }); }
  warning(message: string): void { this.push({ type: 'warning', message: message.slice(0, 300) }); }
  private persist(): void {
    try { fs.mkdirSync(path.dirname(this.fileName), { recursive: true }); const tmp = this.fileName + '.tmp'; fs.writeFileSync(tmp, JSON.stringify({ ...this.status, events: this.events })); fs.renameSync(tmp, this.fileName); } catch { /* best effort */ }
  }
  view(since = 0): JobStatus { return { ...this.status, stages: this.status.stages.map((s) => ({ ...s })), events: this.events.filter((e) => e.seq > since).slice(0, 200) }; }
}

export class UnderstandJobs {
  private records = new Map<string, JobRecord>();
  private queue: JobRecord[] = [];
  private running: JobRecord | null = null;
  private idleWaiters: (() => void)[] = [];
  constructor(readonly paths: UnderstandPaths, private readonly runner: JobRunner) {}

  private storeFile(sceneId: string, jobId: string): string { return path.join(sceneCache(this.paths, sceneId), 'jobs', `${jobId}.json`); }
  uploadsDir(sceneId: string): string { return path.join(sceneCache(this.paths, sceneId), 'uploads'); }

  /** An upload by id, with what kind of file it is (decided from its bytes when it was stored). */
  resolveUpload(sceneId: string, uploadId: string): UnderstandInput | null {
    if (!/^u-[0-9a-f]{8}$/.test(uploadId)) return null;
    const dir = this.uploadsDir(sceneId);
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { return null; }
    const hit = names.find((n) => n.startsWith(`${uploadId}.`));
    if (!hit) return null;
    const kind = hit.endsWith('.pdf') ? 'pdf' : 'image';
    const p = path.join(dir, hit);
    return { path: p, kind, bytes: fs.statSync(p).size };
  }

  /** Jobs that were queued or running when the server stopped become failed. */
  recover(): number {
    let n = 0;
    let scenes: string[] = [];
    try { scenes = fs.readdirSync(this.paths.cacheDir); } catch { return 0; }
    for (const sc of scenes) {
      const dir = path.join(this.paths.cacheDir, sc, 'jobs');
      let files: string[] = [];
      try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const p = path.join(dir, f);
        try {
          const st = JSON.parse(fs.readFileSync(p, 'utf8')) as JobStatus;
          if (st.state !== 'queued' && st.state !== 'running') continue;
          st.state = 'failed'; st.error = RESTART_ERROR; st.updatedAt = new Date().toISOString();
          fs.writeFileSync(p, JSON.stringify(st)); n++;
        } catch { /* leave it */ }
      }
    }
    return n;
  }

  create(sceneId: string, inputs: UnderstandInput[], options: UnderstandOptions): JobStatus {
    if (!SCENE_ID_RE.test(sceneId)) throw new Error('bad scene id');
    const jobId = newJobId();
    const rec = new JobRecord(sceneId, jobId, inputs, options, this.storeFile(sceneId, jobId));
    this.records.set(`${sceneId}/${jobId}`, rec);
    this.queue.push(rec);
    queueMicrotask(() => this.pump());
    return rec.view(0);
  }
  get(sceneId: string, jobId: string, since = 0): JobStatus | null {
    const rec = this.records.get(`${sceneId}/${jobId}`);
    if (rec) return rec.view(since);
    if (!SCENE_ID_RE.test(sceneId) || !/^j-[0-9a-f]{8}$/.test(jobId)) return null;
    try { const st = JSON.parse(fs.readFileSync(this.storeFile(sceneId, jobId), 'utf8')) as JobStatus & { events: JobEvent[] }; st.events = st.events.filter((e) => e.seq > since).slice(0, 200); return st; } catch { return null; }
  }
  /** The newest job of a scene, running or finished. */
  latest(sceneId: string, since = 0): JobStatus | null {
    let best: { id: string; at: string } | null = null;
    for (const r of this.records.values()) if (r.sceneId === sceneId && (!best || r.status.createdAt >= best.at)) best = { id: r.jobId, at: r.status.createdAt };
    try {
      for (const f of fs.readdirSync(path.join(sceneCache(this.paths, sceneId), 'jobs'))) {
        const m = /^(j-[0-9a-f]{8})\.json$/.exec(f); if (!m) continue;
        const st = JSON.parse(fs.readFileSync(path.join(sceneCache(this.paths, sceneId), 'jobs', f), 'utf8')) as JobStatus;
        if (!best || st.createdAt > best.at) best = { id: st.jobId, at: st.createdAt };
      }
    } catch { /* none yet */ }
    return best ? this.get(sceneId, best.id, since) : null;
  }
  cancel(sceneId: string, jobId: string): boolean {
    const rec = this.records.get(`${sceneId}/${jobId}`);
    if (!rec) return false;
    const s = rec.status.state;
    if (s === 'queued') { this.queue = this.queue.filter((r) => r !== rec); rec.controller.abort(); rec.setState('cancelled'); this.checkIdle(); return true; }
    if (s === 'running') { rec.controller.abort(); return true; }
    return false;
  }
  idle(): Promise<void> { if (!this.running && this.queue.length === 0) return Promise.resolve(); return new Promise((r) => this.idleWaiters.push(r)); }
  private checkIdle(): void { if (this.running || this.queue.length > 0) return; for (const w of this.idleWaiters.splice(0)) w(); }
  private pump(): void {
    if (this.running) return;
    const rec = this.queue.shift();
    if (!rec) { this.checkIdle(); return; }
    this.running = rec;
    void this.execute(rec).finally(() => { this.running = null; this.pump(); });
  }
  private async execute(rec: JobRecord): Promise<void> {
    rec.setState('running');
    try {
      const summary = await this.runner({ jobId: rec.jobId, sceneId: rec.sceneId, options: rec.status.options, inputs: rec.inputs, paths: this.paths, signal: rec.controller.signal }, rec);
      if (rec.controller.signal.aborted) { rec.setState('cancelled'); return; }
      rec.status.result = summary;
      rec.setState('done');
    } catch (e) {
      if (e instanceof JobCancelled || rec.controller.signal.aborted) { rec.setState('cancelled'); return; }
      const running = rec.status.stages.find((s) => s.state === 'running');
      if (running) rec.stageEnd(running.id, 'failed');
      rec.setState('failed', e instanceof JobFailure ? e.message : `Something went wrong: ${(e as Error).message}`);
    }
  }
}
