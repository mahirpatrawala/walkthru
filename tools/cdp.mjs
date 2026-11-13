// minimal CDP driver: node cdp.mjs <url> <script.js> ; script is an async function body with (send, eval, shot, sleep, logs)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
const OUT = process.env.CDP_OUT || `${os.tmpdir()}/walkthru-cdp`;
fs.mkdirSync(OUT, { recursive: true });
const [url, scriptPath] = process.argv.slice(2);
const port = 9333 + Math.floor(Math.random() * 500);
const profile = fs.mkdtempSync(`${OUT}/prof-`);
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist', '--window-size=1280,800', '--no-first-run', '--disable-extensions', 'about:blank',
], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let targets;
for (let i = 0; i < 50; i++) { try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); break; } catch { await sleep(200); } }
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const logs = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { const { res, rej } = pending.get(d.id); pending.delete(d.id); d.error ? rej(new Error(JSON.stringify(d.error))) : res(d.result); }
  else if (d.method === 'Runtime.consoleAPICalled') logs.push(`[${d.params.type}] ` + d.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  else if (d.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text));
};
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64')); };
await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: +(process.env.W||1280), height: +(process.env.H||800), deviceScaleFactor: 1, mobile: process.env.MOBILE==='1' });
await send('Page.navigate', { url });
const body = fs.readFileSync(scriptPath, 'utf8');
try {
  const fn = new (Object.getPrototypeOf(async function () {}).constructor)('send', 'ev', 'shot', 'sleep', 'logs', body);
  const out = await fn(send, ev, shot, sleep, logs);
  console.log('RESULT', JSON.stringify(out, null, 1));
} catch (e) { console.log('SCRIPT ERROR', e.message); }
console.log('LOGS\n' + logs.slice(-60).join('\n'));
ws.close(); chrome.kill('SIGKILL');
process.exit(0);
