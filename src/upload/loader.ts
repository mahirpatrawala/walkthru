// The real pdf.js loader for `readPlanPdf`: the worker module first (so pdf.js runs in this thread, which is already a Web Worker
// in the browser), then the one adapter file that imports pdf.js. Dynamic, so nothing of pdf.js is read until a plan is.
import type { ReadOptions } from './read-core';

let loaded: Promise<ReadOptions['load']> | null = null;
export function realLoader(): Promise<ReadOptions['load']> {
  loaded ??= (async () => {
    await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
    const { loadVectorPages } = await import('../import/pdfjs-adapter');
    return (bytes, o) => loadVectorPages(bytes, o);
  })();
  return loaded;
}
