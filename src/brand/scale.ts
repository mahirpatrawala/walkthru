// The interface scale (SPEC 2.7): sets `--wt-z` on <html> from the short side of the window, so the chrome is one CSS pixel on a phone or a
// tablet and larger on a showroom wall display (src/brand/tokens.css reads it). Pure rule + a tiny installer; no dependencies.

/** 1 up to 820 px on the short side, then short side / 820, never more than 3, rounded to 0.05. */
export function scaleFor(width: number, height: number): number {
  const short = Math.min(width, height);
  if (!(short > 0)) return 1;
  const z = Math.min(3, Math.max(1, short / 820));
  return Math.round(z * 20) / 20;
}

/** How much text the chrome can carry: `width / scale` is the room in design units. Icons alone below 1400, the main tools named from 1400, every tool named from 1850. */
export function labelsFor(width: number, height: number): 'icons' | 'primary' | 'full' {
  const u = width / scaleFor(width, height);
  return u >= 1850 ? 'full' : u >= 1400 ? 'primary' : 'icons';
}

/** Applies the scale now and on every resize; returns the remover. Safe to call twice (the second call replaces nothing). */
export function installScale(win: Window = window): () => void {
  const root = win.document.documentElement;
  let raf = 0;
  const apply = (): void => {
    root.style.setProperty('--wt-z', String(scaleFor(win.innerWidth, win.innerHeight)));
    root.dataset.labels = labelsFor(win.innerWidth, win.innerHeight);
  };
  const onResize = (): void => { if (raf) return; raf = win.requestAnimationFrame(() => { raf = 0; apply(); }); };
  apply();
  win.addEventListener('resize', onResize);
  return () => { win.removeEventListener('resize', onResize); if (raf) win.cancelAnimationFrame(raf); };
}
