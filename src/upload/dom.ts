// Tiny DOM helper for the upload screens. Text is always set with textContent, never as HTML.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  parent?.appendChild(e);
  return e;
}
export const SAMPLE_URL = '/upload/sample-plan.pdf';
