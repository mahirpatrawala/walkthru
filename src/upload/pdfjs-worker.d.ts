// The pdf.js worker module sets `globalThis.pdfjsWorker` when it loads, which makes pdf.js run it in the current thread instead of
// starting a second worker (see reader.worker.ts). It ships without a type file.
declare module 'pdfjs-dist/legacy/build/pdf.worker.mjs';
