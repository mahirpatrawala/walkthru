// CDP script body for tools/cdp.mjs: mean wall time of one forced render at the first finish-pass pose. Under headless SwiftShader this is CPU time, a relative
// number between two builds, NOT a GPU frame time. env: N=frames (default 6)
for (let i = 0; i < 1600; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
await ev('window.__walkthru.models.idle()');
for (let i = 0; i < 1200; i++) {
  const r = JSON.parse(await ev(`JSON.stringify((() => { const l = window.__walkthru.look.instance; const p = l.realismProgress(); return { eff: l.realismEffective, done: p.done, total: p.total }; })())`));
  if (r.eff === 'off' || (r.total > 0 && r.done >= r.total)) break;
  await sleep(500);
}
await sleep(4000);
await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
await ev(`window.__walkthru.view.set('first')`);
await ev(`window.__walkthru.freeCam([2.0, 1.6, 5.9], [2.0, 1.4, 10.7], 70)`);
await sleep(2500);
const n = Number(process.env.N || 6);
const ms = [];
for (let i = 0; i < n; i++) {
  const t = await ev(`(() => { const t0 = performance.now(); window.__walkthru.look.instance.debug.renderNow(); const gl = window.__walkthru.ctx.viewer.renderer.getContext(); gl.finish(); return performance.now() - t0; })()`);
  ms.push(Math.round(t));
}
return { tier: await ev('window.__walkthru.look.instance.tier'), ms, mean: Math.round(ms.slice(1).reduce((a, b) => a + b, 0) / Math.max(1, ms.length - 1)) };
