// Screenshots of the Views (SPEC 2.10). Waits for the walk to be up (as tools/landing-shot.cdp.js does), then, by MODE:
//   all    every view of the space, one picture each (`<PREFIX>-<id>.png`), the rings left as a buyer sees them unless RINGS=0
//   ui     the Views opened at view IDS (or the first), the tab of that view shown (`<PREFIX>-ui.png`), and the floor plan card large (`<PREFIX>-map.png`)
//   rings  standing at view IDS with the rings in sight (`<PREFIX>-rings.png`)
//   pano   a synthetic 360 degree picture (a gradient drawn here, with FRONT / RIGHT / BACK / LEFT on it; not a render) on view IDS: arrival, and a look to the right;
//          with MANIFEST=1 the picture the scene's panos/manifest.json gives that view instead (the renderer's own)
// CDP_OUT=~/walkthru-shots/viewpoints PLOG=... MODE=all PREFIX=a3 W=1600 H=900 node tools/cdp.mjs "http://localhost:5830/?building=sample-tower&space=f2-204&chrome=hidden" tools/viewpoints-shot.cdp.js
const fs = await import('node:fs');
const mode = process.env.MODE || 'all', prefix = process.env.PREFIX || 'vp', settle = +(process.env.SETTLE || 6000);
const ids = (process.env.IDS || '').split(',').filter(Boolean);
const t0 = Date.now(); const L = (m) => { const line = `[${prefix}:${mode}] ${Math.round((Date.now() - t0) / 1000)}s ${m}\n`; if (process.env.PLOG) fs.appendFileSync(process.env.PLOG, line); else process.stdout.write(line); };
const tev = (expr, ms = 30000) => Promise.race([ev(expr), sleep(ms).then(() => 'ev-timeout')]).catch((e) => 'err ' + e.message);
const snap = async (name) => {
  const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(180000).then(() => null)]);
  if (r) { fs.writeFileSync(`${process.env.CDP_OUT}/${name}.png`, Buffer.from(r.data, 'base64')); L(`shot ${name}`); } else L(`SHOT TIMED OUT ${name}`);
};
let quiet = 0;
for (let i = 0; i < 150 && quiet < 2; i++) {
  await sleep(3000);
  const s = await tev(`(() => { if (!window.__walkthru || document.getElementById('wt-boot')) return 'wait'; const go = [...document.querySelectorAll('.wt-go')].find(b => b.offsetParent && b.getBoundingClientRect().width > 0); if (go) { go.click(); return 'clicked ' + go.textContent; } return 'up'; })()`);
  if (s !== 'wait') L(s);
  quiet = s === 'up' ? quiet + 1 : 0;
}
L('ready wait: ' + await tev(`Promise.race([Promise.all([window.__walkthru?.look?.ready, window.__walkthru?.models?.idle?.()]).then(() => 'assets in'), new Promise(r => setTimeout(() => r('assets timeout'), 120000))])`, 130000));
// the height picker (first visit) blocks the walk and the rings: start walking
for (let i = 0; i < 10; i++) {
  const r = await tev(`(() => { const b = [...document.querySelectorAll('.wt-go')].filter((x) => !x.closest('[hidden]')); b.forEach((x) => x.click()); return b.length; })()`);
  if (!r) break;
  L('dismissed the picker');
  await sleep(1500);
}
// realistic materials (`&materials=2k`): wait until every texture set is in
for (let i = 0; i < 90; i++) {
  const p = await tev(`(() => { const r = window.__walkthru?.look?.instance?.realismProgress?.(); return r ? r.level + ' ' + r.done + '/' + r.total : 'none'; })()`);
  const m = /(\d+)\/(\d+)/.exec(String(p));
  if (!m || +m[1] >= +m[2]) { L('materials: ' + p); break; }
  await sleep(2000);
}
const list = await tev(`window.__walkthru.viewpoints.list()`);
L(`views: ${Array.isArray(list) ? list.length : list}`);
fs.writeFileSync(`${process.env.CDP_OUT}/${prefix}-list.json`, JSON.stringify(list, null, 1));
if (process.env.RINGS === '0') await tev(`window.__walkthru.viewpoints.showRings(false)`);
const out = {};
if (mode === 'all') {
  for (const v of list) {
    if (ids.length && !ids.includes(v.id)) continue;
    L(`go ${v.id}: ` + await tev(`window.__walkthru.viewpoints.go(${JSON.stringify(v.id)}, true)`));
    await sleep(settle);
    out[v.id] = await tev(`({ at: window.__walkthru.viewpoints.at(), rings: window.__walkthru.viewpoints.rings() })`);
    await snap(`${prefix}-${v.id}`);
  }
}
if (mode === 'ui' || mode === 'rings') {
  const id = ids[0] || list[0].id;
  L('go: ' + await tev(`window.__walkthru.viewpoints.go(${JSON.stringify(id)}, true)`));
  if (mode === 'ui') L('open: ' + await tev(`(window.__walkthru.viewpoints.open(), 'open')`));
  await sleep(settle);
  out.rings = await tev(`window.__walkthru.viewpoints.rings()`);
  out.dots = await tev(`document.querySelectorAll('.wt-nav-vps .wt-nav-vp').length`);
  out.ui = await tev(`[...document.querySelectorAll('[data-testid]')].filter(e => e.offsetParent).map(e => e.dataset.testid).join(',')`);
  await snap(`${prefix}-${mode}`);
  if (mode === 'ui') {
    // the floor plan card, large, with a dot for every view: reach for it (the chrome brings it in) and make it large
    L('map: ' + await tev(`(() => { const t = document.querySelector('[data-testid="nav-map-toggle"]'); const m = document.querySelector('.wt-nav-map'); if (m && !m.classList.contains('is-big')) t?.click(); document.querySelector('.wt-hud')?.classList.add('rv-map'); return document.querySelectorAll('.wt-nav-vps .wt-nav-vp').length + ' dots, current ' + (document.querySelector('.wt-nav-vp.is-current')?.dataset.vp ?? 'none'); })()`));
    await sleep(3000);
    await snap(`${prefix}-map`);
  }
}
if (mode === 'pano') {
  const id = ids[0] || list[0].id;
  const v = list.find((x) => x.id === id);
  // a synthetic picture: a hue gradient across, darker down, with the four directions written where they belong (the middle is the heading)
  const url = await tev(`(() => { const c = document.createElement('canvas'); c.width = 2048; c.height = 1024; const g = c.getContext('2d');
    for (let x = 0; x < 2048; x += 4) { g.fillStyle = 'hsl(' + Math.round(x / 2048 * 360) + ',60%,62%)'; g.fillRect(x, 0, 4, 1024); }
    const sh = g.createLinearGradient(0, 0, 0, 1024); sh.addColorStop(0, 'rgba(255,255,255,0.55)'); sh.addColorStop(0.5, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)'); g.fillStyle = sh; g.fillRect(0, 0, 2048, 1024);
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 512); g.lineTo(2048, 512); g.stroke();
    g.fillStyle = '#111'; g.font = 'bold 72px sans-serif'; g.textAlign = 'center';
    [['FRONT', 0.5], ['RIGHT', 0.75], ['BACK', 0.0], ['BACK', 1.0], ['LEFT', 0.25]].forEach(([t, u]) => g.fillText(t, u * 2048, 500));
    g.font = '28px sans-serif'; g.fillText('synthetic test panorama, not a render', 1024, 580);
    return c.toDataURL('image/jpeg', 0.85); })()`);
  L('pano url bytes ' + String(url).length);
  // MANIFEST=1: the picture comes from the scene's panos/manifest.json (the renderer's), as a buyer gets it; else the synthetic one
  if (process.env.MANIFEST !== '1') L('set: ' + await tev(`(window.__walkthru.viewpoints.setPano(${JSON.stringify(id)}, { url: ${JSON.stringify(url)}, x: ${v.x}, y: ${v.y}, z: ${v.z}, yawDeg: ${v.yawDeg} }), 'set')`));
  // arrive from another view, so the fade in after the glide is the real path
  const other = list.find((x) => x.id !== id && x.tab === v.tab) ?? list.find((x) => x.id !== id);
  L('start at ' + other.id + ': ' + await tev(`window.__walkthru.viewpoints.go(${JSON.stringify(other.id)}, true)`));
  await sleep(3000);
  L('go: ' + await tev(`window.__walkthru.viewpoints.go(${JSON.stringify(id)})`, 120000));
  for (let i = 0; i < 40; i++) { if (await tev(`window.__walkthru.viewpoints.panoShown()`) === true) break; await sleep(1000); }
  out.panoShown = await tev(`window.__walkthru.viewpoints.panoShown()`);
  await sleep(settle);
  out.ui = await tev(`[...document.querySelectorAll('[data-testid]')].filter(e => e.offsetParent).map(e => e.dataset.testid).join(',')`);
  out.note = await tev(`document.querySelector('[data-testid="views-pano-note"]')?.textContent ?? null`);
  await snap(`${prefix}-pano-front`);
  // look a quarter turn to the right by the walk's own look (a drag), as a buyer would
  await tev(`window.__walkthru.camera ? 'cam' : 'nocam'`);
  const r = await tev(`(() => { const c = document.querySelector('#app canvas').getBoundingClientRect(); return { x: c.left + c.width * 0.5, y: c.top + c.height * 0.5 }; })()`);
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: r.x, y: r.y, button: 'left', clickCount: 1 });
  for (let k = 1; k <= 12; k++) { await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x + (k * +(process.env.DRAG || 300)) / 12, y: r.y, button: 'left', buttons: 1 }); await sleep(250); }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: r.x + +(process.env.DRAG || 300), y: r.y, button: 'left', clickCount: 1 });
  await sleep(settle);
  out.panoAfterDrag = await tev(`window.__walkthru.viewpoints.panoShown()`);
  await snap(`${prefix}-pano-right`);
  // Walk from here: back to the live 3D
  await tev(`document.querySelector('[data-testid="views-walk-from-here"]')?.click()`);
  await sleep(4000);
  out.panoAfterWalk = await tev(`window.__walkthru.viewpoints.panoShown()`);
  await snap(`${prefix}-pano-live`);
}
L('result ' + JSON.stringify(out));
return out;
