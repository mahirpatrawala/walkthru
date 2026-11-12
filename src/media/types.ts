// Owned by C9. SPEC 14.4. Imports from ../types only.
import type { Vec2, Vec3, SplatOverlay } from '../types';

// ---------- jobs ----------
export type JobState = 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
export type StageId = 'probe' | 'frames' | 'photos' | 'features' | 'matching' | 'mapping' | 'select' | 'training' | 'publish';
export type StageState = 'pending' | 'running' | 'done' | 'skipped' | 'failed' | 'timeout';
export interface StageStatus { id: StageId; state: StageState; fraction: number; message?: string; startedAt?: string; endedAt?: string }
export interface JobEvent {
  seq: number;                       // strictly increasing per job, from 1
  at: string;                        // ISO 8601
  type: 'state' | 'stage-start' | 'progress' | 'stage-end' | 'warning' | 'log';
  stage?: StageId;
  stageState?: StageState;
  fraction?: number;                 // 0..1 within the stage
  message?: string;
}
export interface MediaOptions {
  mode: 'full' | 'tiny';             // tiny = fast settings for tests (14.6)
  backend: 'local' | 'cloud' | 'fake' | 'none';
  /** also train every other fragment with at least this many frames; 0 = only the largest */
  trainExtraFragmentsMin: number;    // default 0; the UI offers 60
  /** write the splat block into an existing property.json on disk */
  patchProperty: boolean;            // CLI default true; the editor sends false and patches its own draft
  /** skip the training stage (COLMAP only) */
  skipTraining: boolean;             // default false
}
export interface JobStatus {
  jobId: string; sceneId: string; state: JobState;
  createdAt: string; updatedAt: string;
  options: MediaOptions;
  stages: StageStatus[];             // always all nine, in order
  overall: number;                   // 0..1, weighted (14.5)
  events: JobEvent[];                // those with seq > ?since=, at most 200
  lastSeq: number;
  result: MediaResult | null;        // set when state is done
  error?: string;                    // set when state is failed
}

// ---------- results ----------
export interface FrameInfo { file: string; timeSec: number; sharpness: number; width: number; height: number }
export interface PhotoInfo { id: string; file: string; thumb: string; width: number; height: number; originalName: string }
export interface Coverage {
  totalFrames: number; registeredFrames: number;     // largest fragment
  secondsTotal: number; secondsCovered: number;
  spans: { fromSec: number; toSec: number }[];
}
export interface FragmentInfo {
  index: number;                     // 0 = largest
  registeredFrames: number;
  coverage: Coverage;
  /** published file name in the scene folder, or null when not trained */
  ply: string | null;
  splatCount: number | null;
  trainState: 'trained' | 'skipped' | 'failed' | 'timeout';
}
/** Camera centre and viewing direction of a registered frame, in the splat's raw frame. */
export interface FrameCamera { frame: string; timeSec: number; centre: Vec3; forward: Vec3 }
export interface MediaResult {
  frames: FrameInfo[];               // editor frames, sharpest first within time order
  photos: PhotoInfo[];
  /** null when there is no splat; reason says why in plain words */
  splat: SplatOverlay | null;
  splatReason: string;
  fragments: FragmentInfo[];
  cameras: FrameCamera[];            // of fragment 0
  warnings: string[];
}
/** public/scenes/<id>/media/manifest.json = the MediaResult of the latest job plus jobId and a timestamp. */
export interface MediaManifest extends MediaResult { version: 1; jobId: string; finishedAt: string }

// ---------- reconstruction backend ----------
export interface ReconInput {
  workDir: string;                   // absolute; the backend may write anywhere inside it
  imagesDir: string;                 // absolute; frame-000001.jpg ...
  frames: { file: string; timeSec: number }[];
  ordered: boolean;                  // true for video frames, false for a photo set
  mode: 'full' | 'tiny';
  trainExtraFragmentsMin: number;
  skipTraining: boolean;
  signal: AbortSignal;
}
export interface ReconHooks {
  stage(id: 'features' | 'matching' | 'mapping' | 'select' | 'training', state: StageState, message?: string): void;
  progress(id: 'features' | 'matching' | 'mapping' | 'training', fraction: number, message?: string): void;
  log(line: string): void;
}
export interface ReconFragment { registered: { file: string; timeSec: number }[]; cameras: FrameCamera[];
                                 plyPath: string | null; splatCount: number | null; trainState: FragmentInfo['trainState'] }
export interface ReconResult { fragments: ReconFragment[]; upPreset: 'flip-x' | 'as-is' | 'z-up'; warnings: string[] }
export interface ReconstructionBackend {
  readonly name: string;
  /** which tools or credentials are missing; ok = false means the pipeline skips reconstruction */
  available(): Promise<{ ok: boolean; missing: string[] }>;
  /** resolves with zero fragments when nothing reconstructs; rejects only on abort */
  reconstruct(input: ReconInput, hooks: ReconHooks): Promise<ReconResult>;
}

// ---------- photo pins ----------
export interface PhotoPin {
  id: string;                        // = PhotoInfo.id
  file: string;                      // 'media/photos/p-001.jpg', relative to the scene folder
  thumb: string;
  width: number; height: number;
  /** where the photo was taken, world metres; null until placed */
  at: Vec2 | null;
  /** which way the camera faced; null when unknown */
  yawDeg: number | null;
  roomId: string | null;
  caption?: string;
  placedBy: 'broker' | 'auto' | null;
  /** the automatic guess, kept so the broker can accept or ignore it */
  suggested?: { at: Vec2 | null; yawDeg: number | null; roomId: string | null; frame: string | null;
                score: number; source: 'frame-pose' | 'frame-only' | 'none' };
}
/** public/scenes/<id>/photo-pins.json */
export interface PhotoPinsFile { version: 1; pins: PhotoPin[] }
