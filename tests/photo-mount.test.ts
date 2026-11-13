// C12f acceptance (SPEC 17.14): the button, laziness and the three-per-visit limit, with a stub DOM and a stubbed session.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const loads = vi.hoisted(() => ({ session: 0, calls: 0, outcome: 'shown' as string }));
vi.mock('../src/photo/session', () => {
  loads.session++;
  return { takeAiPhoto: async (d: { onSent(): void }) => { loads.calls++; d.onSent(); return loads.outcome; } };
});

class El {
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  className = ''; innerHTML = ''; disabled = false; type = '';
  listeners: Record<string, ((e: unknown) => void)[]> = {};
  parent: El | null = null;
  children: El[] = [];
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
  addEventListener(t: string, f: (e: unknown) => void): void { (this.listeners[t] ??= []).push(f); }
  appendChild(c: El): El { c.parent = this; this.children.push(c); return c; }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; }
  blur(): void {}
  click(): void { for (const f of this.listeners.click ?? []) f({ stopPropagation() {} }); }
}
const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 40));

const json = (b: unknown) => async () => new Response(JSON.stringify(b), { status: 200 });
function setup(status: (() => Promise<Response>) | null) {
  vi.stubGlobal('document', { createElement: () => new El() });
  vi.stubGlobal('fetch', status ?? (() => { throw new Error('offline'); }));
}
const deps = (host: El, toast: (t: string) => void) => ({
  host: host as unknown as HTMLElement, viewer: {} as never, layout: {} as never, items: () => [], withoutCharacter: <T,>(fn: () => T) => fn(), toast,
});

beforeEach(() => {
  loads.calls = 0; loads.outcome = 'shown';
  const mem = new Map<string, string>(); // a fresh tab session per test (recent Node has a real sessionStorage that would carry over)
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('mountAiPhoto', () => {
  it('no button when the server says disabled, not configured, offline, or answers an HTML page', async () => {
    const { mountAiPhoto } = await import('../src/photo/mount');
    for (const s of [json({ enabled: false, configured: true }), json({ enabled: true, configured: false }), null,
      async () => new Response('<!doctype html><html></html>', { status: 200 }), async () => new Response('', { status: 404 })]) {
      setup(s);
      const host = new El();
      mountAiPhoto({ ...deps(host, () => {}), endpoint: '/api/photo' });
      await tick();
      expect(host.children.length).toBe(0);
    }
  });
  it('a button appears when it is enabled and configured; the session chunk loads only on the first tap', async () => {
    setup(json({ enabled: true, configured: true, remainingToday: 10 }));
    const { mountAiPhoto } = await import('../src/photo/mount');
    const host = new El();
    const h = mountAiPhoto(deps(host, () => {}));
    await tick();
    expect(host.children.length).toBe(1);
    expect(h.button?.dataset.testid).toBe('ai-photo');
    expect(loads.session).toBe(0);
    h.button!.click();
    await tick(); await tick();
    expect(loads.session).toBe(1);
    expect(loads.calls).toBe(1);
  });
  it('at most 3 per visit: the fourth tap only says so', async () => {
    setup(json({ enabled: true, configured: true }));
    const { mountAiPhoto } = await import('../src/photo/mount');
    const host = new El();
    const toasts: string[] = [];
    const h = mountAiPhoto(deps(host, (t) => toasts.push(t)));
    await tick();
    for (let i = 0; i < 3; i++) { h.button!.click(); await tick(); await tick() }
    expect(loads.calls).toBe(3);
    h.button!.click(); await tick(); await tick();
    expect(loads.calls).toBe(3);
    expect(toasts.at(-1)).toBe('That is 3 AI photos for this visit.');
  });
  it('the count survives a reload of the page (the tab session) and still holds when storage is blocked', async () => {
    setup(json({ enabled: true, configured: true }));
    const { mountAiPhoto } = await import('../src/photo/mount');
    const h1 = mountAiPhoto(deps(new El(), () => {}));
    await tick();
    for (let i = 0; i < 2; i++) { h1.button!.click(); await tick(); await tick(); }
    const toasts: string[] = [];
    const h2 = mountAiPhoto(deps(new El(), (t) => toasts.push(t))); // "reload": a new mount reads the stored count
    await tick();
    h2.button!.click(); await tick(); await tick();
    h2.button!.click(); await tick(); await tick();
    expect(loads.calls).toBe(3);
    expect(toasts).toEqual(['That is 3 AI photos for this visit.']);
    // storage that throws: the in-page count still limits
    vi.stubGlobal('sessionStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    loads.calls = 0;
    const h3 = mountAiPhoto(deps(new El(), () => {}));
    await tick();
    for (let i = 0; i < 5; i++) { h3.button!.click(); await tick(); await tick(); }
    expect(loads.calls).toBe(3);
  });
  it('the button goes away when the session finds the feature unavailable', async () => {
    setup(json({ enabled: true, configured: true }));
    loads.outcome = 'unavailable';
    const { mountAiPhoto } = await import('../src/photo/mount');
    const host = new El();
    const h = mountAiPhoto(deps(host, () => {}));
    await tick();
    h.button!.click(); await tick(); await tick();
    expect(host.children.length).toBe(0);
  });
});
