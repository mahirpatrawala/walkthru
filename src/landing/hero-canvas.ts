// The landing hero's picture: the featured building as a softly glowing line drawing on a 2D canvas. The levels are stacked on the
// lift core, each one a real plan (hero-model.ts). The lines draw in once, a highlight then moves floor by floor (that floor's walls
// rise a little), a dot strolls through one flat, and the whole stack turns a few degrees with the pointer. Labels are HTML over the
// canvas, so they stay sharp and readable; thin leader lines join them to the drawing. No three.js. Stops when off screen or hidden;
// with reduced motion it draws one settled frame.
import { fitView, pointAlong, project } from './hero-model';
import type { FactId, HeroLevel, HeroModel, HeroView } from './hero-model';

const DEG = Math.PI / 180;
const YAW = -40 * DEG, PITCH = 22 * DEG;
/** storey heights are stretched so each floor's plan shows under the one above */
const STRETCH = 3.1;
/** how high the lit floor's walls rise, metres (a cut-away, not the full storey) */
const WALL_M = 1.25;
const DRAW_START = 0.15, DRAW_STEP = 0.32, DRAW_TIME = 1.25;
const CYCLE_S = 3.6, RISE_S = 0.7;
const WALK_MPS = 2.1;

const INK = '247, 238, 224';        // warm off-white lines
const ACCENT = '240, 144, 111';     // the terracotta, lifted for a dark ground (tokens: --wt-accent-on-glass)
const WATER = '120, 196, 202';      // the brand teal, lifted
const GROUND = '24, 18, 15';        // the hero's charcoal, for the floor plates

/** Where a label sits from its anchor, as fractions of the picture's width and height (wide layout, then narrow). */
const LABEL_AT: Record<FactId, { wide: [number, number]; narrow: [number, number]; side: 'left' | 'right' }> = {
  flat: { wide: [-0.2, -0.13], narrow: [-0.1, -0.15], side: 'left' },
  flats: { wide: [0.2, -0.05], narrow: [0.16, -0.08], side: 'right' },
  pool: { wide: [-0.1, 0.17], narrow: [-0.04, 0.16], side: 'left' },
  lobby: { wide: [0.17, 0.12], narrow: [0.14, 0.12], side: 'right' },
};

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const ease = (t: number): number => { const k = clamp01(t); return k * k * (3 - 2 * k); };
const easeOut = (t: number): number => 1 - Math.pow(1 - clamp01(t), 3);

export interface HeroArt { destroy(): void }

export function mountHeroArt(host: HTMLElement, model: HeroModel, o: { reducedMotion: boolean }): HeroArt {
  const canvas = document.createElement('canvas');
  canvas.className = 'wl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);
  const g = canvas.getContext('2d');
  const labels = document.createElement('ul');
  labels.className = 'wl-callouts';
  host.appendChild(labels);
  const labelEl = new Map<FactId, HTMLLIElement>();
  for (const f of model.facts) {
    const li = document.createElement('li');
    li.className = `wl-callout is-${LABEL_AT[f.id].side}`;
    li.textContent = f.text;
    labels.appendChild(li);
    labelEl.set(f.id, li);
  }
  if (!g) return { destroy() { canvas.remove(); labels.remove(); } };

  // every level's lines sorted along the sweep the draw-in follows, with each line's place in it (0 to 1)
  const order = model.levels.map((level) => {
    const segs = level.spaces.flatMap((s) => s.segs);
    const key = (x: number, z: number): number => x * Math.cos(YAW) - z * Math.sin(YAW);
    const keys = segs.map((s) => Math.min(key(s.a.x, s.a.z), key(s.b.x, s.b.z)));
    const lo = Math.min(...keys), hi = Math.max(...keys);
    return segs.map((s, i) => ({ s, at: hi > lo ? (keys[i] - lo) / (hi - lo) : 0 }));
  });
  const cycle = model.levels.map((l) => l.id);
  const featured = Math.max(0, cycle.indexOf(model.featuredLevelId ?? ''));

  let w = 0, h = 0, dpr = 1;
  let view: HeroView = fitView(model, 1, 1, YAW, PITCH, STRETCH, 0);
  let raf = 0, running = false, onScreen = true, start = 0, lastT = 0;
  let aimX = 0, aimY = 0, curX = 0, curY = 0;
  const size = (): void => {
    const r = host.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    host.classList.toggle('is-narrow', w < 560);
  };

  function strokeLevel(level: HeroLevel, i: number, t: number, lit: number, v: HeroView): void {
    if (!g) return;
    const p = clamp01((t - DRAW_START - i * DRAW_STEP) / DRAW_TIME);
    if (p <= 0) return;
    const shown = easeOut(p);
    // the floor plate: hides the floors below it, as a slab would
    g.fillStyle = `rgba(${GROUND}, ${(level.homes ? 0.92 : 0.6) * shown})`;
    g.beginPath();
    for (const s of level.spaces) for (const poly of s.floors) {
      poly.forEach((q, k) => { const [x, y] = project(v, q.x, level.y, q.z); if (k === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath();
    }
    g.fill();
    if (lit > 0.01) {
      g.fillStyle = `rgba(${ACCENT}, ${0.07 * lit * shown})`;
      g.fill();
    }
    // water
    for (const s of level.spaces) for (const poly of s.water) {
      g.beginPath();
      poly.forEach((q, k) => { const [x, y] = project(v, q.x, level.y, q.z); if (k === 0) g.moveTo(x, y); else g.lineTo(x, y); });
      g.closePath();
      g.fillStyle = `rgba(${WATER}, ${0.2 * shown})`; g.fill();
      g.strokeStyle = `rgba(${WATER}, ${0.85 * shown})`; g.lineWidth = 1; g.stroke();
    }
    // a flats floor's envelope: the storey as a faint box, so the stack reads as a tower
    if (level.homes && level.hull.length >= 3 && p > 0.5) {
      const a = ease((p - 0.5) / 0.5);
      const box = new Path2D();
      level.hull.forEach((q, k) => {
        const [x0, y0] = project(v, q.x, level.y, q.z), [x1, y1] = project(v, q.x, level.top, q.z);
        box.moveTo(x0, y0); box.lineTo(x1, y1);
        const n = level.hull[(k + 1) % level.hull.length];
        const [x2, y2] = project(v, n.x, level.top, n.z);
        box.moveTo(x1, y1); box.lineTo(x2, y2);
      });
      g.strokeStyle = `rgba(${INK}, ${0.16 * a})`; g.lineWidth = 1; g.stroke(box);
    }
    // the plan's lines, each drawing from its start as the sweep reaches it
    const walls = new Path2D(), rails = new Path2D(), up = new Path2D();
    const rise = WALL_M * lit;
    for (const { s, at } of order[i]) {
      const f = p >= 1 ? 1 : clamp01((p * 1.35 - at) / 0.35);
      if (f <= 0) continue;
      const bx = s.a.x + (s.b.x - s.a.x) * f, bz = s.a.z + (s.b.z - s.a.z) * f;
      const [x0, y0] = project(v, s.a.x, level.y, s.a.z), [x1, y1] = project(v, bx, level.y, bz);
      const path = s.rail ? rails : walls;
      path.moveTo(x0, y0); path.lineTo(x1, y1);
      if (rise > 0.02 && !s.rail) {
        const [tx0, ty0] = project(v, s.a.x, level.y + rise / STRETCH, s.a.z), [tx1, ty1] = project(v, bx, level.y + rise / STRETCH, bz);
        up.moveTo(tx0, ty0); up.lineTo(tx1, ty1);
        up.moveTo(x0, y0); up.lineTo(tx0, ty0);
      }
    }
    const mix = (a: number): string => `rgba(${Math.round(247 + (240 - 247) * lit)}, ${Math.round(238 + (144 - 238) * lit)}, ${Math.round(224 + (111 - 224) * lit)}, ${a})`;
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = mix(0.07 + 0.09 * lit); g.lineWidth = 5; g.stroke(walls);       // the glow
    g.strokeStyle = mix(0.58 + 0.34 * lit); g.lineWidth = 1; g.stroke(walls);
    g.strokeStyle = `rgba(${INK}, 0.3)`; g.lineWidth = 1; g.stroke(rails);
    if (rise > 0.02) {
      g.strokeStyle = `rgba(${ACCENT}, ${0.06 * lit})`; g.lineWidth = 4; g.stroke(up);
      g.strokeStyle = `rgba(${ACCENT}, ${0.42 * lit})`; g.lineWidth = 1; g.stroke(up);
    }
  }

  function frame(t: number): void {
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const narrow = w < 560;
    const sway = o.reducedMotion ? 0 : Math.sin(t * 0.33) * 1.3 * DEG;
    view = fitView(model, w, h, YAW, PITCH, STRETCH, Math.min(w, h) * (narrow ? 0.07 : 0.07));
    // the turn is about the fitted centre, so the picture stays put while it turns
    const turned: HeroView = { ...view, yaw: YAW + sway + curX * 4.5 * DEG, pitch: PITCH + curY * 2.5 * DEG };
    const pivot = project(view, 0, 0, 0), now = project(turned, 0, 0, 0);
    turned.cx += pivot[0] - now[0]; turned.cy += pivot[1] - now[1];
    const v = turned;

    // which floor is lit: the settled picture lights the featured one; the cycle starts there once the drawing is in
    const drawn = DRAW_START + (model.levels.length - 1) * DRAW_STEP + DRAW_TIME;
    const litOf = (i: number): number => {
      if (o.reducedMotion) return i === featured ? 1 : 0;
      const c = t - drawn + RISE_S;
      if (c < 0) return 0;
      const step = Math.floor(c / CYCLE_S), into = c - step * CYCLE_S;
      const on = (featured + step) % cycle.length;
      if (i !== on) return 0;
      return Math.min(ease(into / RISE_S), ease((CYCLE_S - into) / RISE_S));
    };

    const roof = model.levels.length ? model.levels[model.levels.length - 1].top : 0;
    model.levels.forEach((level, i) => {
      const lit = litOf(i);
      strokeLevel(level, i, t, lit, v);
      // the lift shafts, drawn up through each floor after its plate so they are never lost under one
      const up = clamp01((t - DRAW_START - i * DRAW_STEP - 0.3) / DRAW_TIME);
      if (up > 0) {
        g.setLineDash([2, 4]);
        g.strokeStyle = `rgba(${ACCENT}, 0.7)`; g.lineWidth = 1;
        g.beginPath();
        for (const c of model.core) {
          const [x0, y0] = project(v, c.x, level.y, c.z), [x1, y1] = project(v, c.x, level.y + ((i === model.levels.length - 1 ? roof : level.top) - level.y) * easeOut(up), c.z);
          g.moveTo(x0, y0); g.lineTo(x1, y1);
        }
        g.stroke();
        g.setLineDash([]);
      }
      // the walker, on its own floor
      if (model.walk && model.walk.levelId === level.id && t > drawn - 0.4) {
        const d = o.reducedMotion ? model.walk.lengthM * 0.3 : (t - drawn) * WALK_MPS;
        const a = clamp01((t - drawn + 0.4) / 0.6);
        g.lineCap = 'round';
        for (let k = 12; k >= 1; k--) {
          const p0 = pointAlong(model.walk.path, d - k * 0.28), p1 = pointAlong(model.walk.path, d - (k - 1) * 0.28);
          const [ax, ay] = project(v, p0.x, level.y, p0.z), [bx, by] = project(v, p1.x, level.y, p1.z);
          g.strokeStyle = `rgba(${ACCENT}, ${a * 0.55 * (1 - k / 13)})`; g.lineWidth = 2;
          g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke();
        }
        const here = pointAlong(model.walk.path, d);
        const [x, y] = project(v, here.x, level.y, here.z);
        g.fillStyle = `rgba(${ACCENT}, ${0.22 * a})`; g.beginPath(); g.arc(x, y, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = `rgba(255, 244, 232, ${a})`; g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill();
      }
    });

    // labels and their leader lines
    model.facts.forEach((f, k) => {
      const el = labelEl.get(f.id);
      const level = model.levels.find((l) => l.id === f.levelId);
      if (!el || !level) return;
      const a = o.reducedMotion ? 1 : ease((t - drawn + 0.5 - k * 0.14) / 0.6);
      const [ax, ay] = project(v, f.at.x, level.y, f.at.z);
      const slot = LABEL_AT[f.id];
      const [dx, dy] = narrow ? slot.narrow : slot.wide;
      const lw = el.offsetWidth, lh = el.offsetHeight;
      // the label's near end: its right end when it sits to the left of the anchor
      let ex = ax + dx * w, ey = ay + dy * h;
      const m = 6;
      if (slot.side === 'left') ex = Math.max(m + lw, Math.min(w - m, ex)); else ex = Math.max(m, Math.min(w - m - lw, ex));
      ey = Math.max(m + lh / 2, Math.min(h - m - lh / 2, ey));
      el.style.transform = `translate(${(slot.side === 'left' ? ex - lw : ex).toFixed(1)}px, ${(ey - lh / 2).toFixed(1)}px)`;
      el.style.opacity = a.toFixed(3);
      el.classList.toggle('is-on', litOf(model.levels.indexOf(level)) > 0.5);
      if (a <= 0) return;
      const gap = slot.side === 'left' ? 8 : -8;
      g.strokeStyle = `rgba(${INK}, ${0.42 * a})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(ax + (ex + gap - ax) * a, ay + (ey - ay) * a); g.stroke();
      g.fillStyle = `rgba(${GROUND}, ${a})`; g.beginPath(); g.arc(ax, ay, 3.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(${ACCENT}, ${a})`; g.lineWidth = 1.5; g.beginPath(); g.arc(ax, ay, 3.5, 0, Math.PI * 2); g.stroke();
    });
  }

  const tick = (ms: number): void => {
    raf = 0;
    if (!running) return;
    if (!start) start = ms;
    // a capture tool may hold the clock: `window.__wlHeroT = seconds`
    const held = (window as unknown as { __wlHeroT?: number }).__wlHeroT;
    const t = typeof held === 'number' ? held : (ms - start) / 1000;
    const dt = Math.min(0.1, Math.max(0, t - lastT)); lastT = t;
    const k = 1 - Math.exp(-dt * 5);
    curX += (aimX - curX) * k; curY += (aimY - curY) * k;
    frame(t);
    raf = requestAnimationFrame(tick);
  };
  let pausedAt = 0;
  const sync = (): void => {
    const want = !o.reducedMotion && onScreen && !document.hidden;
    if (want && !running) {
      running = true;
      // time stands still while the picture is out of sight
      if (pausedAt && start) start += performance.now() - pausedAt;
      pausedAt = 0;
      raf = requestAnimationFrame(tick);
    } else if (!want && running) {
      running = false; pausedAt = performance.now();
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }
  };
  const settled = (): void => { frame(1e4); };

  const onMove = (e: PointerEvent): void => {
    const r = host.getBoundingClientRect();
    aimX = Math.max(-1, Math.min(1, ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1));
    aimY = Math.max(-1, Math.min(1, ((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1));
  };
  const onLeave = (): void => { aimX = 0; aimY = 0; };
  const ro = new ResizeObserver(() => { size(); if (o.reducedMotion || !running) settledOrCurrent(); });
  const settledOrCurrent = (): void => { if (o.reducedMotion) settled(); else if (start) frame(lastT); };
  const io = new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; sync(); });
  const onVis = (): void => sync();
  const area = host.closest<HTMLElement>('.wl-hero') ?? host;
  size();
  ro.observe(host);
  io.observe(host);
  document.addEventListener('visibilitychange', onVis);
  if (o.reducedMotion) settled();
  else {
    area.addEventListener('pointermove', onMove);
    area.addEventListener('pointerleave', onLeave);
    sync();
  }
  return {
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      canvas.remove(); labels.remove();
    },
  };
}
