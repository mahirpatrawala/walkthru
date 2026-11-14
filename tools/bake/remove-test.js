// CDP script body for tools/cdp.mjs: the "no ghost shadow" check of SPEC 16.14. Shoots a view with a piece of furniture, removes it through the
// store, shoots again, and prints the mean colour of the floor patch where it stood (before, after, and the same patch with the bake off).
// env: ITEM=sofa-1  POS=x,z  YAW=deg  PATCH=x,z (world point on the floor where the piece stood)  NAME=prefix  PRESET=afternoon
const item = process.env.ITEM || 'sofa-1';
const [px, pz] = process.env.POS ? process.env.POS.split(',').map(Number) : [NaN, NaN];
const [fx, fz] = process.env.PATCH ? process.env.PATCH.split(',').map(Number) : [NaN, NaN];
const name = process.env.NAME || 'remove';
for (let i = 0; i < 160; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
if (!/bake=off/.test(await ev('location.search'))) await ev('window.__walkthru.bake.handle ? window.__walkthru.bake.handle.ready : null');
await sleep(1200);
if (Number.isFinite(px)) await ev(`window.__walkthru.teleport(${px},${pz})`);
if (process.env.YAW !== undefined) await ev(`window.__walkthru.setYaw(${Number(process.env.YAW)})`);
await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
const hide = "window.__walkthru.person.character.object.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.visible = false; })";
await ev(`window.__walkthru.look.setPreset('${process.env.PRESET || 'afternoon'}')`);
const settle = async () => { await ev(hide); await sleep(2800); await ev('window.__walkthru.look.instance.debug.renderNow()'); };
const patchMean = async () => {
  if (!Number.isFinite(fx)) return null;
  const p = await ev(`JSON.stringify(window.__walkthru.look.project(${fx}, 0, ${fz}))`);
  const xy = JSON.parse(p);
  if (!xy) return null;
  return await ev(`JSON.stringify(window.__walkthru.look.sample(${xy[0] - 12}, ${xy[1] - 8}, ${xy[0] + 12}, ${xy[1] + 8}))`);
};
await settle();
await shot(`${name}-with`);
const before = await patchMean();
await ev(`window.__walkthru.removeItem('${item}')`);
await settle();
await shot(`${name}-removed`);
const after = await patchMean();
const items = await ev('JSON.stringify(window.__walkthru.state().items.map((i) => i.id))');
const probed = await ev("(() => { let n = 0; window.__walkthru.ctx.viewer.scene.traverse((o) => { if (o.userData && o.userData.wtProbed && o.parent) n++; }); return n; })()");
return { item, before, after, items, probedMeshesLeft: probed };
