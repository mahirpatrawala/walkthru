// The reader, as one function that runs the same way in Node (tests, evaluation) and in a browser worker: open the PDF with pdf.js,
// check what kind of PDF it is, run the vector pipeline, apply the reader's own honest statuses, and build the home. No DOM, no Node
// built-ins, no network. The worker (reader.worker.ts) wraps this with progress messages; nothing in here is a second copy of the reader.
import { ImportError } from '../import/types';
import type { VectorPage } from '../import/types';
import { understandVector } from '../understand/vector-adapter';
import type { VectorRun } from '../understand/vector-adapter';
import { applyReview } from '../understand/review-apply';
import type { ExtrasOut } from '../understand/review-apply';
import { emptyReview } from '../understand/review-model';
import type { UnderstandingDoc } from '../understand/review-model';
import type { DesignsFile } from '../look/designs';
import type { PropertyFile } from '../types';
import { buildHome } from './home';
import { notesFor } from './honesty';
import type { UploadNotes } from './honesty';
import { LIMITS, preflightPages, preflightRead, problem, problemFromError } from './problems';
import type { Problem } from './problems';
import { unverifiedRoomsFromExtras } from '../core/room-trust';
import { sha1Hex } from '../understand/hash';

export type Stage = 'open' | 'read' | 'build';
export interface Progress { stage: Stage; /** 0..1 over the whole job; the long middle step cannot report inside itself */ fraction: number; message: string }

/** What the browser keeps for one uploaded home, apart from its id and dates. */
export interface HomeData {
  property: PropertyFile;
  extras: ExtrasOut;
  designs: DesignsFile;
  /** the machine file, kept so "Check the drawing" can be done later without reading the PDF again */
  doc: UnderstandingDoc;
  base: VectorRun['base'];
  notes: UploadNotes;
  pages: number;
  seconds: { open: number; read: number; build: number; total: number; /** from choosing the file to the home being ready (the worker's own total plus loading the reader), set by the page */ wall?: number };
}
export type ReadOutcome = { ok: true; data: HomeData } | { ok: false; problem: Problem };

export interface ReadOptions {
  sceneId: string;
  title: string;
  /** shown under the title; a made-up sample says so here */
  subtitle?: string;
  /** a pure digest of the file, for the machine file's record; not secret and never sent anywhere */
  sha256?: string;
  onProgress?: (p: Progress) => void;
  cancelled?: () => boolean;
  /** the pdf.js loader; Node and the worker both pass the real one (it is a parameter so a test can use a stub) */
  load: (bytes: Uint8Array, o: { maxPages: number; maxOperators: number; onPage: (n: number, total: number) => void; cancelled: () => boolean }) => Promise<VectorPage[]>;
}

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());
const sec = (ms: number): number => Math.round(ms) / 1000;

export async function readPlanPdf(bytes: Uint8Array, o: ReadOptions): Promise<ReadOutcome> {
  const t0 = now();
  const say = (stage: Stage, fraction: number, message: string): void => o.onProgress?.({ stage, fraction, message });
  say('open', 0.02, 'Opening the PDF');
  let pages: VectorPage[];
  try {
    pages = await o.load(bytes, {
      maxPages: LIMITS.maxPages, maxOperators: LIMITS.maxOperators, cancelled: o.cancelled ?? (() => false),
      onPage: (n, total) => say('open', 0.02 + 0.28 * ((n - 1) / Math.max(1, total)), total > 1 ? `Reading page ${n} of ${total}` : 'Reading the page'),
    });
  } catch (e) {
    if (e instanceof ImportError && e.code === 'cancelled') return { ok: false, problem: problem('failed', { detail: 'Stopped.' }) };
    return { ok: false, problem: problemFromError(e) };
  }
  const t1 = now();
  const early = preflightPages(pages);
  if (early) return { ok: false, problem: early };

  say('read', 0.3, 'Finding walls, rooms, doors and sizes');
  let run: VectorRun;
  try {
    run = understandVector(pages, { sceneId: o.sceneId, sha256: o.sha256 ?? sha1Hex(`${bytes.length}`) });
  } catch (e) {
    return { ok: false, problem: problemFromError(e) };
  }
  const t2 = now();
  say('build', 0.9, 'Building your home');
  // the reader's own statuses stand: nothing is confirmed on the visitor's behalf
  const applied = applyReview(run.base, run.doc, emptyReview());
  const late = preflightRead(applied.extras, applied.proposal.rooms.length);
  if (late) return { ok: false, problem: late };
  let property: PropertyFile;
  try {
    property = buildHome(o.sceneId, applied.proposal, applied.extras, o.title, o.subtitle ?? 'Read from an uploaded plan');
  } catch (e) {
    return { ok: false, problem: problem('failed', { detail: e instanceof Error ? e.message : String(e) }) };
  }
  const partial = property.layout.rooms.filter((r) => r.partial).map((r) => ({ label: r.label, reason: r.partial!.reason }));
  const notes = notesFor(applied.extras, unverifiedRoomsFromExtras(applied.extras), partial, 0);
  const t3 = now();
  say('build', 1, 'Done');
  return {
    ok: true,
    data: { property, extras: applied.extras, designs: applied.designs, doc: run.doc, base: run.base, notes, pages: pages.length, seconds: { open: sec(t1 - t0), read: sec(t2 - t1), build: sec(t3 - t2), total: sec(t3 - t0) } },
  };
}
