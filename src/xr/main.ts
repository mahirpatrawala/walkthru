// The VR page's one script (vr.html). It reads the address, shows the flat landing page, builds the app on the page's renderer and, when the address names
// a home, opens it. Nothing here is loaded by the normal site (index.html): the two pages share engine and scene code by import and nothing else.
import './landing.css';
import { fetchHomeList } from './catalogue';
import type { HomeEntry } from './catalogue';
import { VrApp } from './app';
import { mountLanding } from './landing';
import { parseXrUrl } from './url';
import type { BuildingFile } from '../building/types';

async function start(): Promise<void> {
  const url = parseXrUrl(location.search);
  const root = document.getElementById('app');
  if (!root) throw new Error('vr.html has no #app element.');
  let homes: HomeEntry[] = [];
  let buildings = new Map<string, BuildingFile>();
  try { ({ homes, buildings } = await fetchHomeList()); } catch (err) { console.warn('[walkthru-vr] the list of homes could not be read', err); }
  const landing = mountLanding(root, homes, { debug: url.debug });
  const app = new VrApp({
    container: landing.preview, url, homes, buildings,
    makeDriver: async (viewer, vroot) => {
      if (url.fake) { const m = await import('./driver-fake'); return new m.FakeDriver(viewer.camera, vroot); }
      const m = await import('./driver-webxr');
      return new m.WebXrDriver(viewer.renderer, vroot, { scale: url.scale });
    },
  });
  landing.attach(app);
  (window as unknown as { __walkthruVr?: unknown }).__walkthruVr = { app, url };
  await app.init();
  if (url.target) await app.openHome(url.target);
  window.addEventListener('pagehide', () => { try { app.dispose(); } catch { /* leaving anyway */ } }, { once: true });
}

start().catch((err) => {
  console.error('[walkthru-vr] could not start', err);
  const root = document.getElementById('app');
  if (root) root.textContent = `Could not start the VR page. ${err instanceof Error ? err.message : String(err)}`;
});
