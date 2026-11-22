// One product screenshot for the landing page (public/landing/*.webp): waits for the walk to be up, dismisses the person picker, runs PRE, waits SETTLE ms, captures.
// GPU=1 NAME=tour PLOG=/tmp/shots.log CDP_OUT=/tmp/shots W=1280 H=800 PRE="..." node tools/cdp.mjs "http://localhost:5173/?building=sample-tower&space=f2-204&autohide=0" tools/landing-shot.cdp.js ; then cwebp -q 80. SPEC 2.9 lists the addresses.
const fs = await import('node:fs');
const name = process.env.NAME, pre = process.env.PRE || '', settle = +(process.env.SETTLE || 8000), gl = process.env.GL !== '0';
const t0 = Date.now(); const L = (m) => fs.appendFileSync(process.env.PLOG, `[${name}] ` + Math.round((Date.now() - t0) / 1000) + 's ' + m + '\n');
const tev = (expr, ms = 20000) => Promise.race([ev(expr), sleep(ms).then(() => 'ev-timeout')]).catch((e) => 'err ' + e.message);
if (gl) {
  let quiet = 0;
  for (let i = 0; i < 120 && quiet < 2; i++) {
    await sleep(3000);
    const s = await tev(`(() => { if (!window.__walkthru || document.getElementById('wt-boot')) return 'wait'; const go = [...document.querySelectorAll('.wt-go')].find(b => b.offsetParent && b.getBoundingClientRect().width > 0); if (go) { go.click(); return 'clicked ' + go.textContent; } return 'up'; })()`);
    if (s !== 'wait') L(s);
    quiet = s === 'up' ? quiet + 1 : 0;
  }
  L('ready wait: ' + await tev(`Promise.race([Promise.all([window.__walkthru?.look?.ready, window.__walkthru?.models?.idle?.()]).then(() => 'assets in'), new Promise(r => setTimeout(() => r('assets timeout'), 90000))])`, 100000));
} else { for (let i = 0; i < 200; i++) { if (await ev(`!!document.querySelector('.bm svg')`).catch(() => false)) break; await sleep(300); } }
if (pre) L('pre: ' + JSON.stringify(await tev(pre)));
await sleep(settle);
L('ui: ' + await tev(`[...document.querySelectorAll('[data-testid]')].filter(e => e.offsetParent).map(e => e.dataset.testid).slice(0, 30).join(',')`));
const r = await Promise.race([send('Page.captureScreenshot', { format: 'png' }), sleep(120000).then(() => null)]);
if (r) { fs.writeFileSync(`${process.env.CDP_OUT}/${name}.png`, Buffer.from(r.data, 'base64')); L('shot written'); } else L('SHOT TIMED OUT');
return 'end';
