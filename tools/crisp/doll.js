// Captures a building space or a home in the doll house view (SPEC views): env NAME, DOLL_WAIT (seconds). Uses window.__walkthru.views.set('doll').
for (let i = 0; i < 1600; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
await ev('window.__walkthru.models.idle()');
if (!process.env.HUD) await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
await sleep(3000);
await ev("window.__walkthru.views.set('doll')");
await sleep(Number(process.env.DOLL_WAIT || 12) * 1000);
await ev('window.__walkthru.look.instance.debug.renderNow()');
await sleep(1500);
await shot(process.env.NAME || 'doll');
console.log('doll ok');
