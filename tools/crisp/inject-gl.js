// Injected before the page loads (INJECT=...): counts the bytes of every texture the page uploads (width x height x 4, x 4/3 for mips).
(() => {
  const st = { bytes: 0, count: 0 };
  window.__texBytes = st;
  const add = (w, h, levels) => { let b = 0; let ww = w, hh = h; for (let i = 0; i < levels; i++) { b += ww * hh * 4; ww = Math.max(1, ww >> 1); hh = Math.max(1, hh >> 1); if (ww === 1 && hh === 1) break; } st.bytes += b; st.count++; };
  const P = WebGL2RenderingContext.prototype;
  const ts = P.texStorage2D; P.texStorage2D = function (t, lv, f, w, h) { add(w, h, lv); return ts.apply(this, arguments); };
  const ti = P.texImage2D; P.texImage2D = function (t, lvl, f, w, h) { if (lvl === 0 && typeof h === 'number' && arguments.length >= 9) add(w, h, 1); return ti.apply(this, arguments); };
})();
