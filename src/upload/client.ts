// The page's side of the reader: checks the file, starts the worker, relays progress, stops it on cancel or after the time limit.
// The file is read into memory here and handed to the worker by message. It is never sent anywhere else.
import { LIMITS, preflightFile, problem } from './problems';
import type { Problem } from './problems';
import type { HomeData, Progress } from './read-core';
import type { ReadMessage, ReadRequest } from './reader.worker';

export interface ReadJob { result: Promise<{ ok: true; data: HomeData } | { ok: false; problem: Problem }>; cancel(): void }

/** `Uint8Array` -> hex SHA-256 where the browser has it (https and localhost); null elsewhere. Only recorded in the machine file. */
async function digest(bytes: Uint8Array): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const d = new Uint8Array(await subtle.digest('SHA-256', bytes as BufferSource));
    return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch { return undefined; }
}

export function titleFromName(name: string): string {
  const t = name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_\-.]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return t.length >= 2 ? t : 'Your plan';
}

/** `makeWorker` is a parameter so tests can stand in a fake. */
export function startRead(file: File, sceneId: string, title: string, subtitle: string | undefined, onProgress: (p: Progress) => void, makeWorker: () => Worker = () => new Worker(new URL('./reader.worker.ts', import.meta.url), { type: 'module' })): ReadJob {
  let worker: Worker | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let finish: (r: Awaited<ReadJob['result']>) => void = () => {};
  const result = new Promise<Awaited<ReadJob['result']>>((res) => { finish = res; });
  const stop = (): void => { if (timer) clearTimeout(timer); timer = null; worker?.terminate(); worker = null; };
  let over = false;
  const end = (r: Awaited<ReadJob['result']>): void => { over = true; stop(); finish(r); };

  void (async () => {
    let bytes: Uint8Array;
    try {
      const head = new Uint8Array(await file.slice(0, 1100).arrayBuffer());
      const bad = preflightFile(file, head);
      if (bad) return end({ ok: false, problem: bad });
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch { return end({ ok: false, problem: problem('unreadable') }); }
    onProgress({ stage: 'open', fraction: 0.01, message: 'Starting' });
    const sha256 = await digest(bytes);
    if (over) return; // cancelled while the file was being read
    try { worker = makeWorker(); } catch { return end({ ok: false, problem: problem('no-worker') }); }
    worker.onmessage = (ev: MessageEvent<ReadMessage>): void => {
      const m = ev.data;
      if (m.type === 'progress') onProgress(m.progress);
      else if (m.type === 'done') end({ ok: true, data: m.data });
      else if (m.type === 'problem') end({ ok: false, problem: m.problem });
    };
    worker.onerror = (): void => end({ ok: false, problem: problem('failed', { detail: 'The reader stopped unexpectedly.' }) });
    timer = setTimeout(() => end({ ok: false, problem: problem('timeout') }), LIMITS.maxSeconds * 1000);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const req: ReadRequest = { type: 'read', bytes: buf, sceneId, title, subtitle, sha256 };
    worker.postMessage(req, [buf]);
  })();

  return { result, cancel: () => end({ ok: false, problem: problem('failed', { detail: 'Stopped.' }) }) };
}
