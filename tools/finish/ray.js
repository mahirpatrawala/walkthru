// CDP script body: from a pose, raycast through a point of the screen and list what is hit (name, material name, colour, opacity). env: EYE=x,y,z TARGET=x,y,z
for (let i = 0; i < 1600; i++) { if (await ev('!!(window.__walkthru && window.__walkthru.look)')) break; await sleep(250); }
await ev('window.__walkthru.start()');
await ev('window.__walkthru.look.ready');
await sleep(3000);
const eye = process.env.EYE.split(',').map(Number), tgt = process.env.TARGET.split(',').map(Number);
await ev(`window.__walkthru.freeCam(${JSON.stringify(eye)}, ${JSON.stringify(tgt)}, 70)`);
await sleep(1500);
const r = await ev(`(async () => { const w = window.__walkthru; const T = w.ctx.viewer.scene.constructor; const sc = w.ctx.viewer.scene; const cam = w.ctx.viewer.camera;
  const o = cam.position.clone(); const d = { x: ${tgt[0]} - o.x, y: ${tgt[1]} - o.y, z: ${tgt[2]} - o.z };
  const rc = new cam.position.constructor().constructor; return 'n/a'; })()`).catch(() => 'n/a');
const hits = await ev(`(() => { const w = window.__walkthru; const sc = w.ctx.viewer.scene; const cam = w.ctx.viewer.camera; const V = cam.position.constructor;
  const RC = window.__THREE_RAYCASTER; if (!RC) return 'no raycaster hook'; })()`).catch((e) => String(e));
return { r, hits, hooks: await ev('Object.keys(window.__walkthru).join(",")') };
