// A tiny DOM stand-in so the editor's panels and tools can be mounted and driven under Node (no jsdom in the project).
// Only what src/editor/dom.ts and the step panels touch. Not a browser: layout, CSS and real events are not covered.
type Listener = (e: unknown) => void;

export class StubText { constructor(public text: string) {} get textContent(): string { return this.text; } }

export class StubEl {
  children: (StubEl | StubText)[] = [];
  attrs: Record<string, string> = {};
  listeners: Record<string, Listener[]> = {};
  style: Record<string, string> & { setProperty?: never } = {};
  className = '';
  value = '';
  disabled = false;
  parent: StubEl | null = null;
  classList = {
    add: (c: string) => { if (!this.className.split(' ').includes(c)) this.className = `${this.className} ${c}`.trim(); },
    remove: (c: string) => { this.className = this.className.split(' ').filter((x) => x && x !== c).join(' '); },
    toggle: (c: string, on?: boolean) => { const has = this.className.split(' ').includes(c); if (on ?? !has) this.classList.add(c); else this.classList.remove(c); },
  };
  constructor(public tagName: string) {}
  setAttribute(k: string, v: string): void { this.attrs[k] = v; if (k === 'style') this.style = {}; }
  append(...nodes: (StubEl | StubText | string)[]): void {
    for (const n of nodes) {
      const node = typeof n === 'string' ? new StubText(n) : n;
      if (node instanceof StubEl) node.parent = this;
      this.children.push(node);
    }
  }
  appendChild(n: StubEl): StubEl { this.append(n); return n; }
  removeChild(n: StubEl): void { this.children = this.children.filter((c) => c !== n); }
  replaceChildren(...nodes: (StubEl | StubText | string)[]): void { this.children = []; this.append(...(nodes as never[])); }
  get firstChild(): StubEl | StubText | null { return this.children[0] ?? null; }
  set textContent(v: string) { this.children = v ? [new StubText(v)] : []; }
  get textContent(): string { return this.children.map((c) => c.textContent).join(''); }
  addEventListener(type: string, fn: Listener): void { (this.listeners[type] ??= []).push(fn); }
  removeEventListener(type: string, fn: Listener): void { this.listeners[type] = (this.listeners[type] ?? []).filter((f) => f !== fn); }
  dispatch(type: string, ev: unknown = {}): void { for (const f of this.listeners[type] ?? []) f(ev); }
  click(): void { this.dispatch('click', { stopPropagation() {}, preventDefault() {} }); }
  focus(): void {}
  remove(): void { this.parent?.removeChild(this); }
  /** depth-first search */
  all(): StubEl[] { return this.children.flatMap((c) => (c instanceof StubEl ? [c, ...c.all()] : [])); }
  byText(tag: string, text: string | RegExp): StubEl {
    const hit = this.all().find((e) => e.tagName.toLowerCase() === tag && (typeof text === 'string' ? e.textContent === text : text.test(e.textContent)));
    if (!hit) throw new Error(`no <${tag}> with text ${String(text)} in the panel. Buttons: ${this.all().filter((e) => e.tagName === 'BUTTON').map((e) => e.textContent).join(' | ')}`);
    return hit;
  }
}

export function installDomStub(): void {
  const g = globalThis as unknown as Record<string, unknown>;
  g.document = { createElement: (t: string) => new StubEl(t.toUpperCase()), createTextNode: (s: string) => new StubText(s), body: new StubEl('BODY') };
  g.window = { confirm: () => true, devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  // site-relative fetches (the C9 media hook polls /scenes/...) have no server under Node: answer 404
  const realFetch = globalThis.fetch;
  g.fetch = (u: unknown, init?: RequestInit) =>
    typeof u === 'string' && u.startsWith('/') ? Promise.resolve(new Response('', { status: 404 })) : realFetch(u as string, init);
}
