// CDP script body for tools/cdp.mjs: boots a home, forces a tier, sets a camera and takes one screenshot per preset.
// env: PRESETS=afternoon,night  POS=x,z  YAW=deg  NAME=prefix  WAIT=ms  EXTRA=js to run before each shot (optional)
const presets = (process.env.PRESETS || 'afternoon,night').split(',');
const [px, pz] = process.env.POS ? process.env.POS.split(',').map(Number) : [NaN, NaN];
const yaw = process.env.YAW !== undefined ? Number(process.env.YAW) : undefined;
const name = process.env.NAME || 'shot';
const waitMs = Number(process.env.WAIT || 2500);
for (let i = 0; i < 160; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
let bakeState = 'n/a';
if (!/bake=off/.test(await ev('location.search'))) bakeState = await ev('window.__walkthru.bake.handle ? window.__walkthru.bake.handle.ready : "none"');
await sleep(1500);
if (Number.isFinite(px)) await ev(`window.__walkthru.teleport(${px},${pz})`);
if (yaw !== undefined) await ev(`window.__walkthru.setYaw(${yaw})`);
if (!process.env.HUD) await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
const hideChar = "window.__walkthru.person.character.object.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.visible = false; })";
if (process.env.CHAR !== '1') await ev(hideChar);
const out = [];
for (const p of presets) {
  await ev(`window.__walkthru.look.setPreset('${p}')`);
  if (process.env.CHAR !== '1') await ev(hideChar);
  if (process.env.EXTRA) await ev(process.env.EXTRA);
  await sleep(waitMs);
  await ev('window.__walkthru.look.instance.debug.renderNow()');
  await shot(`${name}-${p}`);
  out.push(p);
}
return { bakeState, stats: await ev('JSON.stringify(window.__walkthru.bake.handle && window.__walkthru.bake.handle.stats())'), tier: await ev('window.__walkthru.look.instance.tier'), out };
