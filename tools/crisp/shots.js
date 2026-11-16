// CDP script body for tools/cdp.mjs: the crispness view set. env: SET=flat|club|home  MODE=first|third  NAME=prefix  VIEWS=door,passage,floor,corner,toilet  WAIT=ms
// Camera: first-person views use freeCam (fov 70, eye 1.6 m); third-person views walk the character and use the follow camera.
const set = process.env.SET || 'flat';
const mode = process.env.MODE || 'first';
const name = process.env.NAME || 'shot';
const waitMs = Number(process.env.WAIT || 2500);
for (let i = 0; i < 1600; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
await ev('window.__walkthru.models.idle()');
await sleep(2000);
await ev("(() => { const g = window.__walkthru.ctx.viewer.scene.getObjectByName('debug-grid'); if (g) g.visible = false; })()");
if (!process.env.HUD) await ev("document.querySelectorAll('body > *:not(#app)').forEach((e) => { e.style.display = 'none'; })");
const doorInfo = async (id) => JSON.parse(await ev(`(()=>{const d=window.__walkthruDoors.door(${JSON.stringify(id)}); return JSON.stringify({a:d.edgeA,dir:d.dir,out:d.out,u0:d.u0,u1:d.u1})})()`));
const doorView = async (id, dist = 1.0) => {
  const d = await doorInfo(id); const um = (d.u0 + d.u1) / 2;
  const c = { x: d.a.x + d.dir.x * um, z: d.a.z + d.dir.z * um };
  const sgn = Number(process.env.SIDE || 1);
  const p = { x: c.x + d.out.x * dist * sgn, z: c.z + d.out.z * dist * sgn };
  const yaw = Math.atan2(-d.out.x * sgn, -d.out.z * sgn) * 180 / Math.PI;
  return { eye: [p.x, 1.6, p.z], target: [c.x, 1.25, c.z], yaw, at: p };
};
const signView = async (id, dist = 1.3) => {
  const d = await doorInfo(id); const um = (d.u0 + d.u1) / 2;
  const c = { x: d.a.x + d.dir.x * um, z: d.a.z + d.dir.z * um };
  const sgn = Number(process.env.SIDE || 1);
  const p = { x: c.x + d.out.x * dist * sgn, z: c.z + d.out.z * dist * sgn };
  return { eye: [p.x, 1.6, p.z], target: [c.x, 2.3, c.z], yaw: Math.atan2(-d.out.x * sgn, -d.out.z * sgn) * 180 / Math.PI, at: p };
};
const lookAt = (eye, tgt) => ({ eye, target: tgt, yaw: Math.atan2(tgt[0] - eye[0], tgt[2] - eye[2]) * 180 / Math.PI, at: { x: eye[0], z: eye[2] } });
const views = {};
if (set === 'flat') {
  views.door = await doorView('door-bedroom-1');
  views.sign = await signView('door-bedroom-1');
  views.passage = lookAt([6.75, 1.6, 7.9], [9.8, 1.5, 7.65]);
  views.floor = lookAt([1.0, 1.6, 6.0], [2.9, 0.0, 9.0]);
  views.corner = lookAt([2.4, 1.6, 7.0], [0.08, 2.3, 5.18]);
  views.toilet = lookAt([7.4, 1.6, 5.55], [7.4, 0.8, 3.9]);
  // the zoom test (30 cm from the surface): a floor with joints, a wall with its skirting, a door's edge with its frame
  views.zoomfloor = lookAt([1.4, 0.32, 7.5], [1.55, 0.0, 7.6]);
  views.zoomfloor2 = lookAt([7.3, 0.34, 7.85], [7.55, 0.0, 8.0]);
  views.zoomwall = lookAt([0.38, 0.4, 8.0], [0.08, 0.1, 8.0]);
  { const d = await doorInfo('door-bedroom-1'); const e = d.u1 - 0.02; const c = { x: d.a.x + d.dir.x * e, z: d.a.z + d.dir.z * e };
    views.zoomdoor = { eye: [c.x + d.out.x * 0.32, 1.0, c.z + d.out.z * 0.32], target: [c.x, 0.95, c.z], yaw: 0, at: { x: c.x + d.out.x * 0.32, z: c.z + d.out.z * 0.32 } }; }
} else if (set === 'club') {
  views.stairs = await doorView('door-stairs');
  views.sign = await signView('door-stairs');
} else if (set === 'home') {
  // the standalone sample home (/?scene=test-sample-3)
  views.door = await doorView('door-4');
  views.passage = lookAt([-4.6, 1.6, 0.4], [4.5, 1.5, 0.45]);
  views.floor = lookAt([-1.6, 1.6, -0.9], [0.9, 0.0, -3.0]);
  views.corner = lookAt([0.6, 1.6, -1.0], [2.17, 2.3, -3.69]);
}
const want = (process.env.VIEWS || Object.keys(views).join(',')).split(',');
const out = [];
for (const v of want) {
  const V = views[v]; if (!V) continue;
  if (mode === 'first') {
    await ev(`window.__walkthru.view.set('first')`);
    await ev(`window.__walkthru.freeCam(${JSON.stringify(V.eye)}, ${JSON.stringify(V.target)}, ${Number(process.env.FOV || 70)})`);
    await ev(`window.__walkthru.person.character.object.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.visible = false; })`);
  } else {
    await ev(`window.__walkthru.freeCam(null)`);
    await ev(`window.__walkthru.view.set('third')`);
    await ev(`window.__walkthru.teleport(${V.at.x}, ${V.at.z})`);
    await ev(`window.__walkthru.setYaw(${V.yaw})`);
    await ev(`window.__walkthru.ctx.hud.setVisible(false)`);
    // the follow camera lengthens its boom at 2 m/s of simulated time: advance the simulation 4 s in one frame so the picture is the settled one, whatever the frame rate
    await ev(`window.__walkthru.motion.pause(true, 1/30); window.__walkthru.motion.step(120);`);
    await sleep(1500);
    await ev(`window.__walkthru.person.character.setVisible && window.__walkthru.person.character.setVisible(true)`);
  }
  await sleep(waitMs);
  await ev("(() => { const g = window.__walkthru.ctx.viewer.scene.getObjectByName('debug-grid'); if (g) g.visible = false; })()");
  await ev('window.__walkthru.look.instance.debug.renderNow()');
  await shot(`${name}-${v}`);
  out.push(v);
}
const stats = await ev(`(()=>{ const w = window.__walkthru; const r = w.ctx.viewer.renderer; r.info.autoReset = false; r.info.reset(); w.look.instance.debug.renderNow(); const o = { tier: w.look.instance.tier, pr: r.getPixelRatio(), canvas: [r.domElement.width, r.domElement.height], calls: r.info.render.calls, tris: r.info.render.triangles, tex: r.info.memory.textures, geom: r.info.memory.geometries, programs: r.info.programs.length, texMB: +(window.__texBytes.bytes / 1048576).toFixed(1) }; r.info.autoReset = true; return JSON.stringify(o); })()`).catch(e => String(e));
return { out, stats };
