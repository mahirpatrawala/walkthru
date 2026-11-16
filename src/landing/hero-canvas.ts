// The landing hero's picture: the featured building as a small 3D model drawn on a 2D canvas with our own camera (hero-camera.ts),
// in fine warm lines with a few translucent faces. It is built in front of the visitor: the lower storeys stand, then each flats
// floor is made in stages (the slab slides in, its plan draws itself, the walls rise, furniture lands and a dot walks a flat, the
// facade closes), the roof caps it, the labels come in, it holds, and the round starts again (hero-timeline.ts).
// The visitor can take hold of it: drag to turn and tilt (it coasts on release), pinch or wheel to zoom, two fingers or shift-drag
// to pan, double-click to put it back, arrow keys when it has the focus. Left alone it turns slowly.
// Drawing order: the camera is always above the horizon, so storeys are painted band by band from the ground up, and inside a band
// walls go far to near and roofs last; that is exact for this kind of scene (see SPEC 2.9). No three.js.
import type { Vec2 } from '../types';
import { ELEV_MAX, ELEV_MIN, clampCamera, coast, facesCamera, farToNear, fitScale, orbit, projector, towardCamera, turnTo } from './hero-camera';
import type { Camera, Project } from './hero-camera';
import { occluded } from './hero-building';
import type { Anchor, HeroBuilding, Run, Storey, Win } from './hero-building';
import { pointAlong } from './hero-model';
import type { FactId, HeroFact } from './hero-model';
import { buildState, ease, finished } from './hero-timeline';
import type { BuildState, FloorStage } from './hero-timeline';

const DEG = Math.PI / 180;
const REST_ELEV = 33 * DEG, PREFERRED_YAW = -140 * DEG;
const AUTO_RAD_S = 0.075, RESUME_S = 4;
const INK = '247, 238, 224', ACCENT = '240, 144, 111', WATER = '118, 190, 214';
const RAIL_M = 1.1, SLIDE_M = 16, DROP_M = 5, WALK_MPS = 2.2;
/** light comes from the north-west of the plan, so a turn of the building changes which walls are bright */
const LIGHT = { x: -0.5547, z: -0.832 };

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const DONE: FloorStage = { slab: 1, plan: 1, walls: 1, furnish: 1, facade: 1 };

type Rgb = [number, number, number];
const TONE: Record<string, { dark: Rgb; light: Rgb; a: number }> = {
  base: { dark: [29, 22, 19], light: [60, 46, 39], a: 0.97 },
  club: { dark: [34, 26, 22], light: [70, 53, 45], a: 0.95 },
  room: { dark: [44, 32, 26], light: [86, 62, 50], a: 0.9 },
  flats: { dark: [40, 30, 26], light: [82, 61, 51], a: 0.8 },
  roof: { dark: [36, 28, 24], light: [74, 56, 47], a: 0.96 },
  core: { dark: [74, 40, 30], light: [124, 70, 52], a: 0.92 },
  // the open storeys under the flats: a screen you can see the lobby through
  stilts: { dark: [40, 31, 27], light: [84, 64, 54], a: 0.36 },
};
const shade = (kind: string, nx: number, nz: number, alpha = 1): string => {
  const t = TONE[kind] ?? TONE.base, k = 0.5 + 0.5 * (nx * LIGHT.x + nz * LIGHT.z);
  return `rgba(${Math.round(lerp(t.dark[0], t.light[0], k))}, ${Math.round(lerp(t.dark[1], t.light[1], k))}, ${Math.round(lerp(t.dark[2], t.light[2], k))}, ${t.a * alpha})`;
};

export interface HeroArt { destroy(): void }
export interface HeroArtOptions { reducedMotion: boolean; facts: HeroFact[]; label: string; hint?: HTMLElement | null }

export function mountHeroArt(host: HTMLElement, hb: HeroBuilding, o: HeroArtOptions): HeroArt {
  const canvas = document.createElement('canvas');
  canvas.className = 'wl-canvas';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', o.label);
  host.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const labels = document.createElement('ul');
  labels.className = 'wl-callouts';
  labels.setAttribute('aria-hidden', 'true'); // the canvas's own label says the same facts
  host.appendChild(labels);
  const labelEl = new Map<FactId, HTMLLIElement>();
  for (const f of o.facts) {
    const li = document.createElement('li');
    li.className = 'wl-callout';
    li.textContent = f.text;
    labels.appendChild(li);
    labelEl.set(f.id, li);
  }
  if (!ctx) return { destroy() { canvas.remove(); labels.remove(); } };
  const g: CanvasRenderingContext2D = ctx;

  // ---------------------------------------------------------------- what never changes
  // the storeys the highlight visits while the building holds, lowest first
  const towerLit = hb.storeys.filter((s) => s.kind === 'room' || s.kind === 'club' || s.kind === 'flats').sort((p, q) => p.y0 - q.y0);
  const floorsBuilt = hb.storeys.filter((s) => s.kind === 'flats' && s.build >= 0).length;
  const winsOf = new Map<Run, Win[]>();
  for (const s of hb.storeys) for (const w of s.windows) {
    const mx = (w.a.x + w.b.x) / 2, mz = (w.a.z + w.b.z) / 2;
    const run = s.runs.find((r) => !r.rail && r.nx === w.nx && r.nz === w.nz && Math.abs((mx - r.a.x) * r.nx + (mz - r.a.z) * r.nz) < 0.01 && (mx - r.a.x) * (r.b.x - r.a.x) + (mz - r.a.z) * (r.b.z - r.a.z) >= 0 && (mx - r.b.x) * (r.a.x - r.b.x) + (mz - r.b.z) * (r.a.z - r.b.z) >= 0);
    if (run) { const list = winsOf.get(run); if (list) list.push(w); else winsOf.set(run, [w]); }
  }
  // each floor's plan lines in the order the drawing sweeps them in
  const sweep = new Map<Storey, { a: Vec2; b: Vec2; at: number; rail: boolean }[]>();
  for (const s of hb.storeys) {
    if (!s.plan.length) continue;
    const keys = s.plan.map((q) => Math.min(q.a.x + q.a.z, q.b.x + q.b.z));
    const lo = Math.min(...keys), hi = Math.max(...keys);
    sweep.set(s, s.plan.map((q, i) => ({ a: q.a, b: q.b, rail: q.rail, at: hi > lo ? (keys[i] - lo) / (hi - lo) : 0 })));
  }
  const ring = Array.from({ length: 64 }, (_, i) => ({ x: hb.subject.pivot.x + Math.cos((i / 64) * Math.PI * 2) * hb.subject.radius * 1.04, z: hb.subject.pivot.z + Math.sin((i / 64) * Math.PI * 2) * hb.subject.radius * 1.04 }));

  // the resting view: the turn from which most labels can be seen, nearest the one we like
  const standing = (): boolean => true;
  const seen = (yaw: number): number => {
    const c: Camera = { yaw, elev: REST_ELEV, zoom: 1, panX: 0, panY: 0 }, t = towardCamera(c);
    const dir = { x: t.x * Math.cos(c.elev), y: Math.sin(c.elev), z: t.z * Math.cos(c.elev) };
    return hb.anchors.filter((a) => (a.nx === 0 && a.nz === 0 ? true : facesCamera(c, a.nx, a.nz)) && !occluded(hb, a, dir, standing)).length;
  };
  let restYaw = PREFERRED_YAW, best = -1;
  for (let k = 0; k < 36; k++) {
    const yaw = PREFERRED_YAW + (k % 2 ? -1 : 1) * Math.ceil(k / 2) * 10 * DEG, n = seen(yaw);
    if (n > best) { best = n; restYaw = yaw; }
  }
  const rest: Camera = clampCamera({ yaw: restYaw, elev: REST_ELEV, zoom: 1, panX: 0, panY: 0 });

  // ---------------------------------------------------------------- state
  let cam: Camera = { ...rest };
  let w = 1, h = 1, dpr = 1, scale = 1;
  let raf = 0, running = false, onScreen = true, start = 0, lastMs = 0, clock = 0, dirty = true;
  let velYaw = 0, velElev = 0, idleFor = RESUME_S, homing = 0;
  let frames = 0, labelSeen = new Map<FactId, boolean>();
  const size = (): void => {
    const r = host.getBoundingClientRect();
    w = Math.max(1, r.width); h = Math.max(1, r.height);
    dpr = Math.min(3, window.devicePixelRatio || 1);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    scale = fitScale(hb.subject, { w, h }, REST_ELEV, w < 560 ? 0.025 : 0.05);
    host.classList.toggle('is-narrow', w < 560);
    dirty = true;
  };

  // ---------------------------------------------------------------- drawing
  let P: Project = projector(cam, hb.subject, { w, h }, scale);
  const loopPath = (loop: Vec2[], y: number, ox = 0, oz = 0): void => {
    loop.forEach((q, k) => { const [x, yy] = P(q.x + ox, y, q.z + oz); if (k === 0) g.moveTo(x, yy); else g.lineTo(x, yy); });
    g.closePath();
  };
  const face = (loops: Vec2[][], y: number, fill: string, stroke: string | null, ox = 0, oz = 0): void => {
    g.beginPath();
    for (const l of loops) loopPath(l, y, ox, oz);
    g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = 1; g.stroke(); }
  };
  const quad = (a: Vec2, b: Vec2, y0: number, y1: number): void => {
    const p0 = P(a.x, y0, a.z), p1 = P(b.x, y0, b.z), p2 = P(b.x, y1, b.z), p3 = P(a.x, y1, a.z);
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.lineTo(p1[0], p1[1]); g.lineTo(p2[0], p2[1]); g.lineTo(p3[0], p3[1]); g.closePath();
  };

  /** what a storey looks like now: how far its construction has gone, and how much of it is there at all */
  const stageOf = (s: Storey, st: BuildState): { stage: FloorStage; alpha: number; lift: number; capIn: number } => {
    if (s.build < 0) return { stage: DONE, alpha: st.stand, lift: 0, capIn: 1 };
    const away = 1 - st.keep;
    if (s.kind === 'roof') return { stage: { ...DONE, slab: st.roof, facade: st.roof }, alpha: st.roof * st.keep, lift: away * 4 + (1 - st.roof) * 6, capIn: 1 };
    const stage = st.floors[s.build] ?? DONE;
    // closed from above by the next floor's slab, or by the roof
    const above = s.build + 1 < floorsBuilt ? (st.floors[s.build + 1]?.slab ?? 1) : st.roof;
    return { stage, alpha: Math.min(1, stage.slab * 1.4) * st.keep, lift: away * 4, capIn: above };
  };

  function interior(s: Storey, stage: FloorStage, alpha: number, y: number, capIn: number, st: BuildState): void {
    // once the floor above is on, the inside is only a faint plan through the facade
    const open = 1 - capIn;
    const lines = sweep.get(s);
    if (lines && stage.plan > 0) {
      const flat = new Path2D(), up = new Path2D();
      const rise = (s.y1 - s.y0 - 0.3) * stage.walls;
      for (const q of lines) {
        const f = stage.plan >= 1 ? 1 : clamp01((stage.plan * 1.35 - q.at) / 0.35);
        if (f <= 0) continue;
        const bx = q.a.x + (q.b.x - q.a.x) * f, bz = q.a.z + (q.b.z - q.a.z) * f;
        const p0 = P(q.a.x, y, q.a.z), p1 = P(bx, y, bz);
        flat.moveTo(p0[0], p0[1]); flat.lineTo(p1[0], p1[1]);
        if (rise > 0.05 && !q.rail && open > 0.02) {
          const t0 = P(q.a.x, y + rise, q.a.z), t1 = P(bx, y + rise, bz);
          up.moveTo(t0[0], t0[1]); up.lineTo(t1[0], t1[1]);
          up.moveTo(p0[0], p0[1]); up.lineTo(t0[0], t0[1]);
        }
      }
      const fresh = 1 - stage.facade; // the lines glow while the floor is being made, then go quiet
      g.lineCap = 'round';
      g.strokeStyle = `rgba(${ACCENT}, ${0.12 * fresh * alpha})`; g.lineWidth = 4; g.stroke(flat);
      g.strokeStyle = `rgba(${Math.round(lerp(247, 240, fresh))}, ${Math.round(lerp(238, 144, fresh))}, ${Math.round(lerp(224, 111, fresh))}, ${(0.34 + 0.5 * fresh) * alpha})`; g.lineWidth = 1; g.stroke(flat);
      if (open > 0.02) { g.strokeStyle = `rgba(${ACCENT}, ${(0.22 + 0.34 * fresh) * alpha * open})`; g.stroke(up); }
    }
    if (open <= 0.02) return;
    // furniture: a few blocks that land one after the other
    if (stage.furnish > 0 && s.blocks.length) {
      const order = farToNear(s.blocks.map((b, i) => ({ b, i })), (e) => P(e.b.poly[0].x, y, e.b.poly[0].z)[2]);
      const c = towardCamera(cam);
      for (const { b, i } of order) {
        const mx = b.poly.reduce((u, q) => u + q.x, 0) / b.poly.length, mz = b.poly.reduce((u, q) => u + q.z, 0) / b.poly.length;
        const k = ease((stage.furnish * (s.blocks.length + 6) - i) / 6);
        if (k <= 0) continue;
        const y0 = y + (1 - k) * DROP_M, a = k * alpha * open;
        for (let e = 0; e < b.poly.length; e++) {
          const p = b.poly[e], q = b.poly[(e + 1) % b.poly.length];
          // a side shows when it is on the camera's side of the block
          if (((p.x + q.x) / 2 - mx) * c.x + ((p.z + q.z) / 2 - mz) * c.z <= 0) continue;
          quad(p, q, y0, y0 + b.h);
          g.fillStyle = `rgba(${ACCENT}, ${0.36 * a})`; g.fill();
          g.strokeStyle = `rgba(${ACCENT}, ${0.8 * a})`; g.lineWidth = 1; g.stroke();
        }
        g.beginPath(); loopPath(b.poly, y0 + b.h);
        g.fillStyle = `rgba(250, 190, 160, ${0.5 * a})`; g.fill();
        g.strokeStyle = `rgba(${ACCENT}, ${0.9 * a})`; g.lineWidth = 1; g.stroke();
      }
    }
    // someone walks the flat while it is furnished and closed in
    if (s.walk && stage.furnish > 0) {
      const d = st.round * WALK_MPS, a = ease(stage.furnish * 3) * alpha * open;
      g.lineCap = 'round';
      for (let k = 12; k >= 1; k--) {
        const p0 = pointAlong(s.walk, d - k * 0.3), p1 = pointAlong(s.walk, d - (k - 1) * 0.3);
        const a0 = P(p0.x, y + 0.05, p0.z), a1 = P(p1.x, y + 0.05, p1.z);
        g.strokeStyle = `rgba(255, 236, 214, ${a * 0.7 * (1 - k / 13)})`; g.lineWidth = 2;
        g.beginPath(); g.moveTo(a0[0], a0[1]); g.lineTo(a1[0], a1[1]); g.stroke();
      }
      const here = pointAlong(s.walk, d), [x, yy] = P(here.x, y + 0.05, here.z);
      g.fillStyle = `rgba(${ACCENT}, ${0.3 * a})`; g.beginPath(); g.arc(x, yy, 8, 0, Math.PI * 2); g.fill();
      g.fillStyle = `rgba(255, 246, 236, ${a})`; g.beginPath(); g.arc(x, yy, 3, 0, Math.PI * 2); g.fill();
    }
  }

  function draw(st: BuildState): void {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    P = projector(cam, hb.subject, { w, h }, scale);
    const toward = towardCamera(cam);
    g.lineJoin = 'round';

    // the ground it stands on: a round plot, so a turn reads as a turn
    g.beginPath(); loopPath(ring, 0);
    const c0 = P(hb.subject.pivot.x, 0, hb.subject.pivot.z);
    const rad = Math.max(40, hb.subject.radius * 1.04 * scale * cam.zoom);
    const shadeG = g.createRadialGradient(c0[0], c0[1], 0, c0[0], c0[1], rad);
    shadeG.addColorStop(0, `rgba(10, 7, 6, ${0.55 * st.stand})`); shadeG.addColorStop(0.7, `rgba(10, 7, 6, ${0.3 * st.stand})`); shadeG.addColorStop(1, 'rgba(10, 7, 6, 0)');
    g.fillStyle = shadeG; g.fill();
    g.setLineDash([1, 6]); g.strokeStyle = `rgba(${INK}, ${0.3 * st.stand})`; g.lineWidth = 1; g.stroke(); g.setLineDash([]);

    const litIndex = st.lit < 0 ? -1 : Math.floor(st.lit), litK = st.lit < 0 ? 0 : Math.min(ease((st.lit - litIndex) * 4), ease((1 - (st.lit - litIndex)) * 4));
    const litStorey = litIndex >= 0 ? towerLit[litIndex] ?? null : null;

    for (const band of hb.bands) {
      const here = farToNear(hb.storeys.filter((s) => s.y0 === band), (s) => { const q = s.loops[0]?.[0]; return q ? P(q.x, s.y0, q.z)[2] : 0; });
      const walls: { depth: number; paint: () => void }[] = [];
      const caps: (() => void)[] = [];
      for (const s of here) {
        const { stage, alpha, lift, capIn } = stageOf(s, st);
        if (alpha <= 0.004) continue;
        const y0 = s.y0 + lift, y1 = s.y1 + lift, tall = y1 - y0;
        const lit = s === litStorey ? litK : 0;
        // the floor it stands on: a slab, sliding in for a floor that is being built
        if (s.kind === 'flats' || s.kind === 'roof' || s.kind === 'stilts' || s.kind === 'club') {
          const slide = (1 - stage.slab) * SLIDE_M;
          face(s.loops, y0, `rgba(33, 25, 21, ${0.96 * alpha})`, `rgba(${INK}, ${0.5 * alpha})`, slide, 0);
        }
        if (s.kind === 'flats') interior(s, stage, alpha, y0 + 0.02, capIn, st);
        if (s.kind === 'stilts') {
          // open storeys: a column at each corner of the block above
          for (const loop of s.loops) for (const q of loop) {
            const a = P(q.x, y0, q.z), b = P(q.x, y1, q.z);
            walls.push({ depth: a[2] - 0.02, paint: () => { g.strokeStyle = `rgba(${INK}, ${0.4 * alpha})`; g.lineWidth = 1.6; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke(); } });
          }
        }
        const grow = s.kind === 'flats' || s.kind === 'roof' ? stage.facade : 1;
        const kind = s.kind;
        s.runs.forEach((r, i) => {
          const front = facesCamera(cam, r.nx, r.nz);
          // the far side of a storey is seen from inside only where there is no lid: the roof's parapet
          if (!front && kind !== 'roof') return;
          // the facade closes run by run round the floor
          const k = grow >= 1 ? 1 : ease((grow * (s.runs.length + 8) - i) / 8);
          if (k <= 0) return;
          const top = y0 + (r.rail ? Math.min(RAIL_M, tall) : tall) * k;
          const mid = P((r.a.x + r.b.x) / 2, (y0 + y1) / 2, (r.a.z + r.b.z) / 2);
          walls.push({
            depth: mid[2] + (front ? 0 : -0.01),
            paint: () => {
              quad(r.a, r.b, y0, top);
              g.fillStyle = shade(kind, front ? r.nx : -r.nx, front ? r.nz : -r.nz, alpha * (front ? 1 : 0.8) * (kind === 'flats' ? lerp(0.86, 1.16, capIn) : 1)); g.fill();
              g.strokeStyle = `rgba(${INK}, ${(r.rail ? 0.6 : kind === 'stilts' ? 0.2 : 0.34) * alpha})`; g.lineWidth = 1; g.stroke();
              if (lit > 0.01 && front) { g.fillStyle = `rgba(${ACCENT}, ${0.2 * lit * alpha})`; g.fill(); g.strokeStyle = `rgba(${ACCENT}, ${0.85 * lit * alpha})`; g.stroke(); }
              if (!front || k < 0.7) return;
              for (const win of winsOf.get(r) ?? []) {
                quad(win.a, win.b, y0 + win.sill, y0 + Math.min(win.head, tall - 0.2));
                const wa = alpha * ease((k - 0.7) / 0.3);
                g.fillStyle = win.door ? `rgba(${ACCENT}, ${0.85 * wa})` : `rgba(255, ${Math.round(206 + 20 * lit)}, ${Math.round(160 + 30 * lit)}, ${(0.5 + 0.35 * lit) * wa})`; g.fill();
                g.strokeStyle = `rgba(${INK}, ${0.55 * wa})`; g.lineWidth = 1; g.stroke();
              }
            },
          });
        });
        if (s.cap) caps.push(() => {
          const top = s.kind === 'core' ? `rgba(104, 58, 44, ${0.95 * alpha})` : s.water.length ? `rgba(47, 37, 32, ${0.97 * alpha})` : `rgba(52, 40, 34, ${0.96 * alpha})`;
          face(s.loops, y1, top, `rgba(${INK}, ${0.5 * alpha})`);
          for (const pool of s.water) {
            g.beginPath(); loopPath(pool, y1);
            g.fillStyle = `rgba(${WATER}, ${0.5 * alpha})`; g.fill();
            g.strokeStyle = `rgba(190, 232, 244, ${0.9 * alpha})`; g.lineWidth = 1; g.stroke();
          }
        });
      }
      for (const wl of farToNear(walls, (q) => q.depth)) wl.paint();
      for (const cap of caps) cap();
    }
  }

  // ---------------------------------------------------------------- labels
  function placeLabels(st: BuildState): void {
    const narrow = w < 560;
    const toward = towardCamera(cam);
    const dir = { x: toward.x * Math.cos(cam.elev), y: Math.sin(cam.elev), z: toward.z * Math.cos(cam.elev) };
    const solid = (s: Storey): boolean => stageOf(s, st).alpha > 0.5 && (s.build < 0 || (st.floors[s.build]?.facade ?? 1) > 0.5);
    const check = frames % 3 === 0;
    const placed: { top: number; bottom: number; left: number; right: number }[] = [];
    const cx = w / 2, cyy = h / 2;
    const items = hb.anchors.map((a) => ({ a, p: P(a.x, a.y, a.z) })).sort((p, q) => p.p[1] - q.p[1]);
    for (const { a, p } of items) {
      const el = labelEl.get(a.id);
      if (!el) continue;
      const built = a.id === 'flat' || a.id === 'flats';
      const on = built ? st.labels : ease((st.stand - 0.7) / 0.3);
      if (check || !labelSeen.has(a.id)) labelSeen.set(a.id, (a.nx === 0 && a.nz === 0 ? true : facesCamera(cam, a.nx, a.nz)) && !occluded(hb, anchorNow(a, st), dir, solid));
      const inFrame = p[0] > 4 && p[0] < w - 4 && p[1] > 4 && p[1] < h - 4;
      const show = on > 0.02 && (labelSeen.get(a.id) ?? false) && inFrame;
      const lw = el.offsetWidth, lh = el.offsetHeight;
      // out from the middle of the picture, to the side the anchor is on
      // out to the side the anchor is on, clear of the building's own width where the frame has the room
      const left = p[0] < cx, clear = hb.subject.radius * scale * cam.zoom * (narrow ? 0.4 : 0.6);
      const vy = p[1] < cyy ? -1 : 1;
      let ex = left ? Math.min(p[0] - 30, cx - clear) : Math.max(p[0] + 30, cx + clear), ey = p[1] + vy * (narrow ? 18 : 26);
      const m = 6;
      let x0 = left ? ex - lw : ex;
      x0 = Math.max(m, Math.min(w - m - lw, x0));
      let y0 = Math.max(m, Math.min(h - m - lh, ey - lh / 2));
      // on a narrow screen the building fills the frame: the labels keep to its top and bottom edges, off the model
      if (narrow) { x0 = left ? m : w - m - lw; y0 = vy < 0 ? m : h - m - lh - 28; }
      for (let guard = 0; guard < 6; guard++) {
        const hit = placed.find((q) => x0 < q.right + 6 && x0 + lw > q.left - 6 && y0 < q.bottom + 5 && y0 + lh > q.top - 5);
        if (!hit) break;
        y0 = (narrow ? vy > 0 : vy < 0) ? hit.top - lh - 6 : hit.bottom + 6;
      }
      y0 = Math.max(m, Math.min(h - m - lh, y0));
      if (show) placed.push({ top: y0, bottom: y0 + lh, left: x0, right: x0 + lw });
      ex = left ? x0 + lw : x0; ey = y0 + lh / 2;
      el.style.transform = `translate(${x0.toFixed(1)}px, ${y0.toFixed(1)}px)`;
      el.style.opacity = show ? on.toFixed(2) : '0';
      if (!show) continue;
      g.strokeStyle = `rgba(${INK}, ${0.5 * on})`; g.lineWidth = 1;
      g.beginPath(); g.moveTo(p[0], p[1]); g.lineTo(ex + (left ? 6 : -6), ey); g.stroke();
      g.fillStyle = `rgba(24, 18, 15, ${on})`; g.beginPath(); g.arc(p[0], p[1], 3.5, 0, Math.PI * 2); g.fill();
      g.strokeStyle = `rgba(${ACCENT}, ${on})`; g.lineWidth = 1.5; g.beginPath(); g.arc(p[0], p[1], 3.5, 0, Math.PI * 2); g.stroke();
    }
  }
  const anchorNow = (a: Anchor, st: BuildState): Anchor => (st.keep < 1 && (a.id === 'flat' || a.id === 'flats') ? { ...a, y: a.y + (1 - st.keep) * 4 } : a);

  // ---------------------------------------------------------------- the loop
  type Held = { __wlHeroT?: number; __wlHeroCam?: Partial<Camera>; __wlHeroMs?: number; __wlHeroView?: Camera };
  const held = (): Held => window as unknown as Held;
  let cost = 0;
  const frame = (ms: number): void => {
    raf = 0;
    if (!running) return;
    if (!start) { start = ms; lastMs = ms; }
    const dt = Math.min(0.1, Math.max(0, (ms - lastMs) / 1000)); lastMs = ms;
    clock += dt;
    // a capture tool may hold the clock and the camera: `window.__wlHeroT = seconds` (1000 or more: the finished building), `__wlHeroCam`
    const hold = held();
    const t = typeof hold.__wlHeroT === 'number' ? hold.__wlHeroT : clock;
    const st = o.reducedMotion || t >= 1000 ? finished(floorsBuilt) : buildState(t, floorsBuilt, towerLit.length);
    if (hold.__wlHeroCam) { cam = clampCamera({ ...cam, ...hold.__wlHeroCam }); dirty = true; }
    else if (pointers.size === 0) {
      idleFor += dt;
      if (homing > 0) {
        const k = 1 - Math.pow(0.001, dt / 0.6);
        cam = clampCamera({ yaw: cam.yaw + turnTo(cam.yaw, rest.yaw) * k, elev: lerp(cam.elev, rest.elev, k), zoom: lerp(cam.zoom, 1, k), panX: lerp(cam.panX, 0, k), panY: lerp(cam.panY, 0, k) });
        homing -= dt; dirty = true;
      } else if (Math.abs(velYaw) > 0.01 || Math.abs(velElev) > 0.01) {
        cam = orbit(cam, velYaw * dt, velElev * dt);
        velYaw = coast(velYaw, dt, 0.2); velElev = coast(velElev, dt, 0.2); dirty = true;
      } else if (!o.reducedMotion && idleFor > RESUME_S) {
        cam = orbit(cam, AUTO_RAD_S * ease((idleFor - RESUME_S) / 2) * dt, 0); dirty = true;
      }
    }
    if (dirty || !(o.reducedMotion || t >= 1000)) {
      const t0 = performance.now();
      draw(st); placeLabels(st);
      cost = cost ? cost * 0.9 + (performance.now() - t0) * 0.1 : performance.now() - t0;
      hold.__wlHeroMs = cost; hold.__wlHeroView = cam;
      frames++; dirty = false;
    }
    raf = requestAnimationFrame(frame);
  };
  const sync = (): void => {
    const want = onScreen && !document.hidden;
    if (want && !running) { running = true; lastMs = 0; start = 0; dirty = true; raf = requestAnimationFrame((ms) => { start = ms; lastMs = ms; frame(ms); }); }
    else if (!want && running) { running = false; if (raf) cancelAnimationFrame(raf); raf = 0; }
  };

  // ---------------------------------------------------------------- taking hold of it
  const pointers = new Map<number, { x: number; y: number }>();
  // a finger's first few pixels decide: sideways takes hold of the building, up or down is the page's scroll (touch-action: pan-y)
  let lock: 'pending' | 'turn' | 'scroll' = 'turn', lockX = 0, lockY = 0;
  let panning = false, engaged = false, lastTap = 0, lastTapAt = { x: 0, y: 0 }, moved = 0, pinch = 0, lastMove = 0;
  const used = (): void => {
    idleFor = 0; homing = 0;
    if (o.hint && !o.hint.classList.contains('is-used')) { o.hint.classList.add('is-used'); try { sessionStorage.setItem('walkthru:hero-used', '1'); } catch { /* private mode */ } }
  };
  const home = (): void => { velYaw = 0; velElev = 0; homing = 0.9; idleFor = 0; };
  const spread = (): number => { const [a, b] = [...pointers.values()]; return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0; };
  const onDown = (e: PointerEvent): void => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2) return;
    canvas.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    panning = e.shiftKey || e.button === 2;
    engaged = true; moved = 0; velYaw = 0; velElev = 0; lastMove = performance.now();
    pinch = pointers.size === 2 ? spread() : 0;
    lock = e.pointerType === 'touch' && pointers.size === 1 ? 'pending' : 'turn'; lockX = 0; lockY = 0;
    if (lock === 'turn') { canvas.classList.add('is-dragging'); used(); }
  };
  const onMove = (e: PointerEvent): void => {
    const was = pointers.get(e.pointerId);
    if (!was) return;
    const dx = e.clientX - was.x, dy = e.clientY - was.y;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved += Math.abs(dx) + Math.abs(dy);
    if (lock === 'pending') {
      lockX += dx; lockY += dy;
      if (Math.hypot(lockX, lockY) < 8) return;
      lock = Math.abs(lockX) >= Math.abs(lockY) ? 'turn' : 'scroll';
      if (lock === 'turn') { canvas.classList.add('is-dragging'); used(); }
    }
    if (lock === 'scroll' && pointers.size < 2) return;
    idleFor = 0;
    if (pointers.size >= 2) {
      // two fingers: apart or together zooms, together across pans
      const d = spread();
      if (pinch > 0 && d > 0) cam = clampCamera({ ...cam, zoom: cam.zoom * (d / pinch) });
      pinch = d;
      cam = clampCamera({ ...cam, panX: cam.panX + dx / 2 / w, panY: cam.panY + dy / 2 / h });
    } else if (panning) cam = clampCamera({ ...cam, panX: cam.panX + dx / w, panY: cam.panY + dy / h });
    else {
      const dYaw = -dx * 0.0085, dElev = dy * 0.006;
      cam = orbit(cam, dYaw, dElev);
      // the speed it is let go at: over the real time between moves, smoothed over the last few
      const now = performance.now(), gap = Math.max(0.008, Math.min(0.1, (now - lastMove) / 1000));
      velYaw = velYaw * 0.5 + (dYaw / gap) * 0.5; velElev = velElev * 0.5 + (dElev / gap) * 0.5;
      lastMove = now;
    }
    dirty = true;
  };
  const onUp = (e: PointerEvent): void => {
    if (!pointers.delete(e.pointerId)) return;
    pinch = 0;
    if (pointers.size === 0) {
      canvas.classList.remove('is-dragging');
      if (panning || cam.elev <= ELEV_MIN + 1e-3 || cam.elev >= ELEV_MAX - 1e-3) velElev = 0;
      if (panning) velYaw = 0;
      // held still before letting go: it stays where it was put
      if (performance.now() - lastMove > 90) { velYaw = 0; velElev = 0; }
      velYaw = Math.max(-3, Math.min(3, velYaw)); velElev = Math.max(-1.2, Math.min(1.2, velElev));
      // a second tap in the same place puts the view back
      const now = performance.now();
      if (e.type === 'pointerup' && moved < 8) {
        if (e.pointerType !== 'mouse' && now - lastTap < 320 && Math.hypot(e.clientX - lastTapAt.x, e.clientY - lastTapAt.y) < 30) home();
        lastTap = now; lastTapAt = { x: e.clientX, y: e.clientY };
        velYaw = 0; velElev = 0;
      }
      if (e.pointerType !== 'mouse') engaged = false;
    }
  };
  const onWheel = (e: WheelEvent): void => {
    // the page scrolls unless the visitor has taken hold of the building (or holds a modifier, as a trackpad pinch does)
    if (!(engaged || e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    cam = clampCamera({ ...cam, zoom: cam.zoom * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016)) });
    used(); dirty = true;
  };
  const onKey = (e: KeyboardEvent): void => {
    const k = e.key;
    if (k === 'ArrowLeft') cam = orbit(cam, 0.14, 0);
    else if (k === 'ArrowRight') cam = orbit(cam, -0.14, 0);
    else if (k === 'ArrowUp') cam = orbit(cam, 0, 0.07);
    else if (k === 'ArrowDown') cam = orbit(cam, 0, -0.07);
    else if (k === '+' || k === '=') cam = clampCamera({ ...cam, zoom: cam.zoom * 1.12 });
    else if (k === '-' || k === '_') cam = clampCamera({ ...cam, zoom: cam.zoom / 1.12 });
    else if (k === 'Home' || k === '0' || k === 'Escape') { used(); home(); e.preventDefault(); return; }
    else return;
    e.preventDefault(); used(); velYaw = 0; velElev = 0; dirty = true;
  };
  const onLeave = (): void => { if (pointers.size === 0) engaged = false; };
  const onDbl = (): void => { used(); home(); };
  const onMenu = (e: Event): void => { e.preventDefault(); };
  try { if (o.hint && sessionStorage.getItem('walkthru:hero-used')) o.hint.classList.add('is-used'); } catch { /* private mode */ }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('keydown', onKey);
  canvas.addEventListener('dblclick', onDbl);
  canvas.addEventListener('contextmenu', onMenu);
  const ro = new ResizeObserver(() => { size(); });
  const io = new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; sync(); });
  const onVis = (): void => sync();
  size();
  ro.observe(host);
  io.observe(host);
  document.addEventListener('visibilitychange', onVis);
  sync();
  return {
    destroy() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect(); io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      canvas.remove(); labels.remove();
    },
  };
}
