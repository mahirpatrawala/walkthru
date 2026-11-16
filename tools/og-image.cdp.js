// Draws public/og.png (1200 x 630, the picture a link preview shows) from the landing page itself, so the tower in it is the real one.
// Run with the dev server up:  W=1200 H=630 DPR=1 OUTFILE=public/og.png node tools/cdp.mjs "http://localhost:5173/" tools/og-image.cdp.js
const fs = await import('node:fs');
for (let i = 0; i < 400; i++) { if (await ev(`!!document.querySelector('.wl-art.is-ready')`).catch(() => false)) break; await sleep(200); }
// the finished building with the name, the label line and the headline: no buttons, no paragraph, no facts strip
await ev(`(() => {
  window.__wlHeroT = 1000;
  const st = document.createElement('style');
  st.textContent = '.wl-navbtn,.wl-navlink,.wl-copy-more,.wl-facts,.wl-hint,.wl-story,.wl-projects,.wl-closing{display:none!important}.wl-nav{border:0!important;background:none!important;backdrop-filter:none!important;padding-left:0!important}.wl-nav .wt-brand{font-size:30px!important}.wl-nav .wt-brand-mark{width:38px!important;height:38px!important}.wl-hero{padding:44px 56px!important;min-height:630px!important;height:630px!important}.wl-grid{padding-top:0!important;grid-template-columns:minmax(0,0.95fr) minmax(0,1.05fr)!important;grid-template-areas:"top art"!important;grid-template-rows:1fr!important}.wl-copy-top{align-self:center!important}.wl-hero h1{font-size:54px!important}.wl-hero .wl-copy>.wl-label{font-size:12px!important;white-space:normal!important;letter-spacing:0.12em!important}.wl-art{height:500px!important;margin-right:-40px!important}';
  document.head.appendChild(st);
})()`);
await sleep(2500);
const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
fs.writeFileSync(process.env.OUTFILE || 'og.png', Buffer.from(r.data, 'base64'));
return 'written';
