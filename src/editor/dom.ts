// Owned by C5. A tiny DOM builder for the step panels (no framework, SPEC 1).
type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; style?: string; text?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = String(v);
      else if (k === 'text') el.textContent = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** A drop zone that also opens a file picker on click. `onFiles` gets only files whose name or type matches `accept`. */
export function dropZone(opts: { title: string; hint: string; accept: string; multiple?: boolean; onFiles: (files: File[]) => void }): HTMLElement {
  const input = h('input', { type: 'file', accept: opts.accept, multiple: !!opts.multiple, style: 'display:none' });
  const zone = h('div', { class: 'drop', tabIndex: 0, role: 'button' }, h('strong', { text: opts.title }), h('span', { class: 'muted', text: opts.hint }), input);
  const accepted = (f: File): boolean => {
    const parts = opts.accept.split(',').map((s) => s.trim().toLowerCase());
    return parts.some((p) => (p.startsWith('.') ? f.name.toLowerCase().endsWith(p) : p.endsWith('/*') ? f.type.startsWith(p.slice(0, -1)) : f.type === p));
  };
  const take = (list: FileList | null): void => {
    const files = Array.from(list ?? []).filter(accepted);
    if (files.length > 0) opts.onFiles(opts.multiple ? files : files.slice(0, 1));
  };
  zone.addEventListener('click', () => input.click());
  zone.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
  input.addEventListener('change', () => { take(input.files); input.value = ''; });
  zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('over'));
  zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); take(e.dataTransfer?.files ?? null); });
  return zone;
}
