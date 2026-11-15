// The reader's thread. The page posts the PDF's bytes and gets progress, then either a home or a plain-English problem. Terminated by the page
// on cancel or timeout. Nothing here touches the network: the bytes come in by message and the answer goes out by message.
import { readPlanPdf } from './read-core';
import type { HomeData, Progress } from './read-core';
import { realLoader } from './loader';
import { problemFromError } from './problems';
import type { Problem } from './problems';

export interface ReadRequest { type: 'read'; bytes: ArrayBuffer; sceneId: string; title: string; subtitle?: string; sha256?: string }
export type ReadMessage =
  | { type: 'progress'; progress: Progress }
  | { type: 'done'; data: HomeData }
  | { type: 'problem'; problem: Problem };

const post = (m: ReadMessage): void => (self as unknown as { postMessage(m: unknown): void }).postMessage(m);

self.onmessage = (ev: MessageEvent<ReadRequest>): void => {
  const req = ev.data;
  if (!req || req.type !== 'read') return;
  void (async () => {
    try {
      const load = await realLoader();
      const out = await readPlanPdf(new Uint8Array(req.bytes), { sceneId: req.sceneId, title: req.title, subtitle: req.subtitle, sha256: req.sha256, load, onProgress: (progress) => post({ type: 'progress', progress }) });
      post(out.ok ? { type: 'done', data: out.data } : { type: 'problem', problem: out.problem });
    } catch (e) {
      post({ type: 'problem', problem: problemFromError(e) });
    }
  })();
};
