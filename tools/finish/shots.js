// CDP script body for tools/cdp.mjs: the finish-pass view set (SPEC 16.26). Fixed first-person poses, UI hidden.
// env: SET=tower|sample1|son|all  NAME=prefix  VIEWS=a,b  WAIT=ms  FOV=deg
// run: W=1600 H=900 DPR=1 CDP_OUT=<dir> SET=tower NAME=before node tools/cdp.mjs "http://localhost:5199/?scene=test-tower-flat-3bhk-a&quality=high&materials=2k&kiosk=1" tools/finish/shots.js
const set = process.env.SET || 'tower';
const name = process.env.NAME || 'shot';
const waitMs = Number(process.env.WAIT || 2500);
for (let i = 0; i < 1600; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
await ev('window.__walkthru.models.idle()');
for (let i = 0; i < 1200; i++) {
  const r = JSON.parse(await ev(`JSON.stringify((() => { const l = window.__walkthru.look.instance; const p = l.realismProgress(); return { eff: l.realismEffective, done: p.done, total: p.total }; })())`));
  if (r.eff === 'off' || (r.total > 0 && r.done >= r.total)) break;
  await sleep(500);
}
await sleep(4500);
await ev("(() => { const g = window.__walkthru.ctx.viewer.scene.getObjectByName('debug-grid'); if (g) { g.visible = false; g.removeFromParent(); } })()");
await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
const lookAt = (eye, tgt) => ({ eye, target: tgt });
const views = {};
if (set === 'tower') {
  views.living = lookAt([2.0, 1.6, 5.9], [2.0, 1.4, 10.7]);         // living room toward the balcony glass
  views.dining = lookAt([1.0, 1.6, 9.9], [4.8, 1.2, 6.0]);          // living/dining toward the kitchen side and entry
  views.master = lookAt([8.6, 1.6, 6.2], [11.0, 1.1, 4.2]);         // master bedroom, bed and window
  views.kitchen = lookAt([5.3, 1.55, 4.0], [4.7, 1.25, 2.1]);       // kitchen counters
  views.bath = lookAt([11.1, 1.55, 8.3], [10.7, 0.9, 7.15]);        // toilet-1 fittings
} else if (set === 'sample1') {
  views.living = lookAt([-2.3, 1.6, 0.9], [-5.2, 1.2, -1.0]);
} else if (set === 'son') {
  views.bedroom = lookAt([2.2, 1.6, 1.5], [-0.4, 1.0, -1.0]);
}
const want = (process.env.VIEWS || Object.keys(views).join(',')).split(',');
const out = [];
for (const v of want) {
  const V = views[v]; if (!V) continue;
  await ev(`window.__walkthru.view.set('first')`);
  await ev(`window.__walkthru.freeCam(${JSON.stringify(V.eye)}, ${JSON.stringify(V.target)}, ${Number(process.env.FOV || 70)})`);
  await ev(`window.__walkthru.person.character.object.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.visible = false; })`);
  await sleep(waitMs);
  await ev("(() => { const g = window.__walkthru.ctx.viewer.scene.getObjectByName('debug-grid'); if (g) { g.visible = false; g.removeFromParent(); } })()");
  await ev('window.__walkthru.look.instance.debug.renderNow()');
  await shot(`${name}-${v}`);
  out.push(v);
}
const stats = await ev(`(()=>{ const w = window.__walkthru; const r = w.ctx.viewer.renderer; r.info.autoReset = false; r.info.reset(); w.look.instance.debug.renderNow(); const o = { tier: w.look.instance.tier, real: w.look.instance.realismEffective, pr: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], calls: r.info.render.calls, tris: r.info.render.triangles, tex: r.info.memory.textures }; r.info.autoReset = true; return JSON.stringify(o); })()`).catch(e => String(e));
return { out, stats };
