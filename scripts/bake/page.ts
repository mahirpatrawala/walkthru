// Drives the real app in headless Chrome to dump the scene it builds (SPEC 16.13 step 1). One source of geometry: the runtime's own.
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { SceneDump } from '../../src/look/baked/types';

const CHROME_DEFAULT = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PageDump { dump: SceneDump; bin: Buffer }

/** Starts the Vite dev server in-process unless a base URL is given. Returns the URL and a closer. */
export async function ensureServer(baseUrl: string | undefined): Promise<{ url: string; close(): Promise<void> }> {
  if (baseUrl) return { url: baseUrl.replace(/\/$/, ''), close: async () => {} };
  const { createServer } = await import('vite');
  const port = 5600 + Math.floor(Math.random() * 300);
  const server = await createServer({ server: { port, strictPort: false, host: '127.0.0.1' }, logLevel: 'error' });
  await server.listen();
  const addr = server.httpServer?.address();
  const p = typeof addr === 'object' && addr ? addr.port : port;
  return { url: `http://127.0.0.1:${p}`, close: () => server.close() };
}

/** Loads the home in headless Chrome and returns what `window.__walkthru.bake.exportScene()` gives. Always kills Chrome. */
export async function dumpScene(sceneId: string, opts: { url: string; profileRoot: string; timeoutMs?: number }): Promise<PageDump> {
  const chromeBin = process.env.CHROME_BIN || CHROME_DEFAULT;
  if (!fs.existsSync(chromeBin)) throw new Error(`Chrome not found at ${chromeBin} (set CHROME_BIN)`);
  fs.mkdirSync(opts.profileRoot, { recursive: true });
  const profile = fs.mkdtempSync(path.join(opts.profileRoot, 'prof-'));
  const port = 9700 + Math.floor(Math.random() * 400);
  let chrome: ChildProcess | null = spawn(chromeBin, [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist', '--window-size=1280,800', '--no-first-run', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });
  let ws: WebSocket | null = null;
  try {
    type Target = { type: string; webSocketDebuggerUrl: string };
    let targets: Target[] = [];
    for (let i = 0; i < 60 && targets.length === 0; i++) { try { targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Target[]; } catch { await sleep(250); } }
    const page = targets.find((t) => t.type === 'page');
    if (!page) throw new Error('headless Chrome did not start');
    ws = new WebSocket(page.webSocketDebuggerUrl);
    const sock = ws;
    await new Promise<void>((res, rej) => { sock.onopen = () => res(); sock.onerror = () => rej(new Error('CDP socket failed')); });
    let id = 0;
    const pending = new Map<number, { res(v: unknown): void; rej(e: Error): void }>();
    sock.onmessage = (m) => {
      const d = JSON.parse(String(m.data)) as { id?: number; result?: unknown; error?: unknown };
      if (d.id && pending.has(d.id)) { const p = pending.get(d.id)!; pending.delete(d.id); d.error ? p.rej(new Error(JSON.stringify(d.error))) : p.res(d.result); }
    };
    const send = (method: string, params: object = {}): Promise<unknown> => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); sock.send(JSON.stringify({ id: i, method, params })); });
    const ev = async <T>(expression: string): Promise<T> => {
      const r = (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })) as { result: { value: T }; exceptionDetails?: { exception?: { description?: string }; text: string } };
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
      return r.result.value;
    };
    await send('Runtime.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    // the geometry does not depend on the tier we boot in; `bake=off` keeps an existing bake out of the dump's way
    await send('Page.navigate', { url: `${opts.url}/?scene=${encodeURIComponent(sceneId)}&quality=medium&bake=off&kit=on` });
    const deadline = Date.now() + (opts.timeoutMs ?? 120_000);
    for (;;) {
      if (Date.now() > deadline) throw new Error('timed out waiting for the scene to build in the page');
      let ready = false;
      try { ready = await ev<boolean>('!!(window.__walkthru && window.__walkthru.bake)'); } catch { /* page still loading */ }
      if (ready) break;
      await sleep(400);
    }
    await ev('window.__walkthru.look ? window.__walkthru.look.ready : null');
    await sleep(800);
    const res = await ev<{ dump: SceneDump; bin: string }>('window.__walkthru.bake.exportScene()');
    return { dump: res.dump, bin: Buffer.from(res.bin, 'base64') };
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    chrome?.kill('SIGKILL');
    chrome = null;
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
