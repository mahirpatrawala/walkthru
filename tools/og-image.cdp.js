// Draws public/og.png (1200 x 630, the picture a link preview shows) from the landing page itself, so the tower in it is the real one.
// Run with the dev server up:  W=1200 H=630 DPR=1 OUTFILE=public/og.png node tools/cdp.mjs "http://localhost:5173/" tools/og-image.cdp.js
const fs = await import('node:fs');
for (let i = 0; i < 400; i++) { if (await ev(`!!document.querySelector('.wl-art.is-ready')`).catch(() => false)) break; await sleep(200); }
// the picture alone with the name and the line: no buttons, no facts strip, the featured floor lit
await ev(`(() => {
  window.__wlHeroT = 3.6;
  const st = document.createElement('style');
  st.textContent = '.wl-navbtn,.wl-actions,.wl-facts,.wl-lead,.wl-projects{display:none!important}.wl-nav{border:0!important;background:none!important;backdrop-filter:none!important;padding-left:0!important}.wl-nav .wt-brand{font-size:30px!important}.wl-nav .wt-brand-mark{width:38px!important;height:38px!important}.wl-hero{padding:44px 56px!important;min-height:630px!important;height:630px!important}.wl-grid{padding-top:0!important;grid-template-columns:minmax(0,1fr) minmax(0,1fr)!important}.wl-hero h1{font-size:56px!important}.wl-label{font-size:13px!important}.wl-art{height:500px!important;margin-right:-56px!important}';
  document.head.appendChild(st);
})()`);
await sleep(2500);
const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
fs.writeFileSync(process.env.OUTFILE || 'og.png', Buffer.from(r.data, 'base64'));
return 'written';
