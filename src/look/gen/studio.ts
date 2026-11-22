// Studio, functional and amenity pieces of a gym (SPEC 16.17): exercise ball, plyo box, battle rope with its anchor, a hung heavy bag, wall bars, a suspension
// frame; a mirror panel, water dispenser, towel and sanitiser station, lockers (a bank of 6 or 12), a changing-room bench, a weighing scale, a wall fan and
// rubber flooring tiles. Wall pieces carry `liftM` (their underside above the floor, like a basin or a geyser). Sizes are exactly the item's.
import * as THREE from 'three';
import { Parts, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { genCeiling } from './ceiling';
import { ACCENT_BLUE, ACCENT_RED, CHROME, CONSOLE, FRAME, FRAME_GREY, IRON, PAD_BLACK, RUBBER, SCREEN_GLASS, SHROUD, SHROUD_LIGHT, WOOD_ASH, cylX, cylY, cylZ, grip, pad, rtube, slab, tube } from './gymkit';
const RUBBER_FLOOR: MatSpec = { key: 'rubberFloor' };

export const STUDIO_VARIANTS = ['ball', 'plyo', 'rope', 'bag', 'wallbars', 'trx', 'mirror', 'water', 'towel', 'lockers', 'locker-bench', 'scale', 'fan', 'tiles'] as const;
export type StudioVariant = (typeof STUDIO_VARIANTS)[number];
export interface StudioParams { variant: StudioVariant; liftM: number }
export const STUDIO_DEFAULTS: StudioParams = { variant: 'ball', liftM: 0 };

// a mirror below 2K: bright polished metal picks up the room's light and probe, which reads as a mirror (at 2K it reflects live, src/look/premium/mirrors.ts)
const MIRROR_GLASS: MatSpec = { key: 'metal', tint: '#E4E9ED' };
// SPEC 16.17.2: a clubhouse locker is a laminate door (a warm oak) on a light grey carcass, not a school locker in blue paint
const LOCKER_DOOR: MatSpec = { key: 'wood', tint: '#B98C5E' };
const LOCKER_BODY: MatSpec = { key: 'laminate', tint: '#D2D5D8' };

export function buildStudio(env: GenEnv, size: GenSize, p: StudioParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (STUDIO_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'ball';
  const parts = new Parts(env, `gen:studio`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;
  const lift = p.liftM ?? 0;
  const seg = q.tier === 'low' ? 12 : q.tier === 'medium' ? 20 : 28;
  const wseg = q.tier === 'low' ? 12 : 16;
  const build: Record<string, () => void> = {
    ball: () => {
      const r = w / 2;
      parts.put('ball', roleOr(roles, ACCENT_BLUE, 'ball'), new THREE.SphereGeometry(r, seg, seg / 2).translate(0, r, 0), { tile: 0.5 });
      cylY(parts, 'ball-valve', IRON, 0, 0, 0.0, 0.004, 0.015, 8);
    },
    plyo: () => {
      parts.box('plyo-box', WOOD_ASH, -x1, x1, 0, H, z0, z1, { c: 0.012 });
      // hand holes on the long sides, and a non-slip top
      for (const s of [-1, 1]) slab(parts, 'plyo-hand-holes', IRON, s * x1 - 0.003 + (s > 0 ? 0.003 : -0.003), s * x1 + (s > 0 ? 0.004 : -0.004), H - 0.2, H - 0.14, -0.1, 0.1);
      for (const s of [-1, 1]) slab(parts, 'plyo-hand-holes', IRON, -0.12, 0.12, H - 0.2, H - 0.14, s * z1 - 0.003 + (s > 0 ? 0.003 : -0.003), s * z1 + (s > 0 ? 0.004 : -0.004));
      slab(parts, 'plyo-top', RUBBER, -x1 + 0.03, x1 - 0.03, H - 0.0, H + 0.0001, z0 + 0.03, z1 - 0.03);
    },
    rope: () => {
      // a base plate with an anchor post and a strap ring; two heavy ropes run from the ring and coil on the floor in front
      slab(parts, 'rope-base', RUBBER, -x1, x1, 0, 0.03, z0, z0 + 0.34);
      cylY(parts, 'rope-post', FRAME, 0, z0 + 0.17, 0.03, H - 0.04, 0.045, 12);
      parts.put('rope-ring', CHROME, new THREE.TorusGeometry(0.05, 0.012, 6, 14).rotateY(Math.PI / 2).translate(0, H - 0.05, z0 + 0.17));
      const ropeM = roleOr(roles, { key: 'weave', tint: '#2F3236' }, 'ropeFibre');
      for (const s of [-1, 1]) {
        tube(parts, 'rope', ropeM, [s * 0.04, H - 0.05, z0 + 0.17], [s * 0.2, 0.05, z0 + 0.46], 0.019);
        for (let i = 0; i < 2; i++) parts.put('rope', ropeM, new THREE.TorusGeometry(0.068 + i * 0.025, 0.019, 6, 18).rotateX(Math.PI / 2).translate(s * 0.125, 0.02 + i * 0.02, z1 - 0.115));
      }
      slab(parts, 'rope-feet-pad', RUBBER, -x1 + 0.02, x1 - 0.02, 0, 0.012, z0 + 0.34, z1);
    },
    bag: () => {
      // a 36 cm heavy bag hung on four chains from one hook in the ceiling; the chains and the hook are above the item's height
      const r = w / 2, bottom = H - 1.2;
      const bagM = roleOr(roles, ACCENT_RED, 'bag');
      cylY(parts, 'bag-body', bagM, 0, 0, bottom, H, r, Math.max(16, q.sides * 3));
      for (const y of [bottom + 0.3, bottom + 0.9]) cylY(parts, 'bag-straps', IRON, 0, 0, y - 0.025, y + 0.025, r + 0.003, Math.max(16, q.sides * 3));
      cylY(parts, 'bag-caps', IRON, 0, 0, H - 0.004, H, r * 0.8, 14);
      cylY(parts, 'bag-caps', IRON, 0, 0, bottom, bottom + 0.004, r * 0.8, 14);
      const top = H + 0.03, ceil = Math.max(genCeiling(), H + 0.3);
      parts.put('bag-chains', CHROME, new THREE.TorusGeometry(0.03, 0.006, 5, 10).rotateX(Math.PI / 2).translate(0, top, 0));
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) tube(parts, 'bag-chains', CHROME, [a * 0.14, H, b * 0.14], [0, top + 0.22, 0], 0.004);
      tube(parts, 'bag-chains', CHROME, [0, top + 0.22, 0], [0, ceil - 0.05, 0], 0.005);
      cylY(parts, 'bag-hook', FRAME, 0, 0, ceil - 0.05, ceil, 0.05, 10);
    },
    wallbars: () => {
      // Swedish ladder: two wooden uprights and a round rung every 12 cm, fixed to the wall at the back
      const n = Math.floor((H - 0.2) / 0.12);
      for (const s of [-1, 1]) parts.box('wallbars-uprights', WOOD_ASH, s * (x1 - 0.035) - 0.035, s * (x1 - 0.035) + 0.035, 0, H, z0, z1, { c: 0.004, grain: 'y' });
      for (let i = 0; i < n; i++) {
        const y = 0.18 + i * 0.12;
        tube(parts, 'wallbars-rungs', WOOD_ASH, [-x1 + 0.07, y, 0], [x1 - 0.07, y, 0], 0.016, true);
      }
      tube(parts, 'wallbars-rungs', WOOD_ASH, [-x1 + 0.07, H - 0.02, 0], [x1 - 0.07, H - 0.02, 0], 0.016, true);
    },
    trx: () => {
      // a suspension-training frame: four posts, a top rail along the front and back, two strap sets hanging from the front rail
      const px = x1 - 0.04, pz = z1 - 0.04;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'trx-posts', FRAME, sx * px - 0.04, sx * px + 0.04, 0, H, sz * pz - 0.04, sz * pz + 0.04);
      for (const sz of [-1, 1]) slab(parts, 'trx-rails', FRAME, -x1, x1, H - 0.08, H, sz * pz - 0.04, sz * pz + 0.04);
      for (const sx of [-1, 1]) { slab(parts, 'trx-rails', FRAME, sx * px - 0.04, sx * px + 0.04, H - 0.08, H, -pz, pz); slab(parts, 'trx-feet', FRAME, sx * px - 0.04, sx * px + 0.04, 0, 0.05, -z1, z1); }
      for (const sz of [-1, 1]) slab(parts, 'trx-feet', FRAME, -x1, x1, 0, 0.05, sz * pz - 0.04, sz * pz + 0.04);
      for (const cx of [-0.5, 0.5]) {
        tube(parts, 'trx-straps', ACCENT_RED, [cx - 0.03, H - 0.08, pz], [cx - 0.03, 0.85, pz + 0.03], 0.012);
        tube(parts, 'trx-straps', ACCENT_RED, [cx + 0.03, H - 0.08, pz], [cx + 0.03, 0.85, pz + 0.03], 0.012);
        for (const s of [-1, 1]) grip(parts, [cx + s * 0.03, 0.9, pz + 0.03], [cx + s * 0.03, 0.78, pz + 0.03], 0.02);
      }
    },
    mirror: () => {
      // a wall mirror panel on a thin frame, its underside `liftM` above the floor
      parts.box('mirror-frame', FRAME_GREY, -x1, x1, lift, H, z0, z1 - 0.004, { c: 0.002 });
      slab(parts, 'mirror-glass', MIRROR_GLASS, -x1 + 0.012, x1 - 0.012, lift + 0.012, H - 0.012, z1 - 0.004, z1 + 0.0);
    },
    water: () => {
      // a bottom-loading cooler: a body with a glass bottle door, a tap deck with a hot and a cold tap, a drip tray, a display
      parts.box('cooler-body', SHROUD_LIGHT, -x1, x1, 0.04, H, z0, z1, { c: 0.01 });
      slab(parts, 'cooler-plinth', FRAME, -x1 + 0.02, x1 - 0.02, 0, 0.04, z0 + 0.02, z1 - 0.02);
      slab(parts, 'cooler-door', { key: 'sheer', tint: '#9FB8C7' }, -x1 + 0.03, x1 - 0.03, 0.1, 0.5, z1 - 0.004, z1 + 0.002);
      cylY(parts, 'cooler-bottle', { key: 'sheer', tint: '#6FA3C4' }, 0, 0, 0.12, 0.46, 0.115, 12);
      slab(parts, 'cooler-deck', CONSOLE, -x1 + 0.03, x1 - 0.03, S - 0.16, S + 0.06, z1 - 0.1, z1 + 0.0);
      slab(parts, 'cooler-display', SCREEN_GLASS, -0.05, 0.05, S + 0.0, S + 0.05, z1 - 0.002, z1 + 0.002);
      for (const [sx, m] of [[-0.065, ACCENT_BLUE], [0.065, ACCENT_RED]] as const) cylY(parts, 'cooler-taps', m, sx, z1 - 0.04, S - 0.2, S - 0.15, 0.012, 8);
      slab(parts, 'cooler-tray', FRAME, -x1 + 0.04, x1 - 0.04, S - 0.28, S - 0.26, z1 - 0.12, z1 + 0.0);
      slab(parts, 'cooler-top', SHROUD, -x1 + 0.01, x1 - 0.01, H - 0.02, H, z0 + 0.01, z1 - 0.01);
    },
    towel: () => {
      // a stand: a frame with a shelf of folded towels, a used-towel bin below and a hand-sanitiser pump on a post
      const cx = -x1 + 0.2;
      slab(parts, 'tw-base', FRAME, -x1, x1, 0, 0.04, z0, z1);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(parts, 'tw-posts', FRAME_GREY, [sx * (x1 - 0.03), 0.04, sz * (z1 - 0.03)], [sx * (x1 - 0.03), 0.9, sz * (z1 - 0.03)], 0.014);
      for (const y of [0.55, 0.9]) slab(parts, 'tw-shelves', WOOD_ASH, -x1, x1, y - 0.02, y, z0, z1);
      for (let i = 0; i < 6; i++) parts.box('tw-towels', { key: 'cotton', tint: '#F2F0EA' }, -x1 + 0.03 + (i % 3) * 0.12, -x1 + 0.13 + (i % 3) * 0.12, 0.9 + Math.floor(i / 3) * 0.05, 0.95 + Math.floor(i / 3) * 0.05 + (i === 5 ? 0.0 : 0), z0 + 0.04, z1 - 0.04, { c: 0.004 });
      parts.box('tw-bin', { key: 'laminate', tint: '#5C6168' }, -x1 + 0.04, 0.04, 0.05, 0.5, z0 + 0.04, z1 - 0.04, { c: 0.01 });
      // the sanitiser: a pump bottle at the right on the top shelf, reaching exactly the item's height
      cylY(parts, 'tw-sanitiser', { key: 'gloss', tint: '#E8EEF2' }, x1 - 0.12, 0, 0.9, H - 0.06, 0.045, 12);
      cylY(parts, 'tw-sanitiser', ACCENT_BLUE, x1 - 0.12, 0, H - 0.06, H - 0.03, 0.02, 8);
      slab(parts, 'tw-sanitiser', ACCENT_BLUE, x1 - 0.12 - 0.005, x1 - 0.12 + 0.07, H - 0.035, H, -0.012, 0.012);
      void cx;
    },
    lockers: () => {
      // a bank of clubhouse lockers, two tiers high: oak-laminate doors with shadow gaps, a slim vent slot, a stainless pull and a key lock,
      // an engraved number plate; a light grey carcass on a dark recessed plinth, a flat top
      const cols = Math.max(1, Math.round(w / 0.3));
      const zf = z1 - 0.01; // the door face: the pulls stand 1 cm proud of it, to the box's front
      const cw = w / cols, plinth = 0.1, top = H - 0.03, tier = (top - plinth) / 2, gap = 0.003;
      parts.box('locker-plinth', { key: 'powder', tint: '#3A3D42' }, -x1 + 0.01, x1 - 0.01, 0, plinth, z0 + 0.02, z1 - 0.04, { c: 0.002 });
      parts.box('locker-body', LOCKER_BODY, -x1, x1, plinth, H, z0, zf - 0.018, { c: 0.003 });
      for (let c = 0; c < cols; c++) for (let t = 0; t < 2; t++) {
        const xa = -x1 + c * cw + gap, xb = -x1 + (c + 1) * cw - gap;
        const ya = plinth + t * tier + gap, yb = plinth + (t + 1) * tier - gap;
        parts.box('locker-doors', LOCKER_DOOR, xa, xb, ya, yb, zf - 0.018, zf, { c: 0.002, grain: 'y' });
        const cx = (xa + xb) / 2;
        if (q.slats) parts.box('locker-vents', { key: 'powder', tint: '#2A2C30' }, cx - 0.06, cx + 0.06, yb - 0.05, yb - 0.04, zf - 0.001, zf + 0.0005, { c: 0 });
        parts.box('locker-handles', CHROME, xb - 0.04, xb - 0.025, (ya + yb) / 2 - 0.07, (ya + yb) / 2 + 0.07, zf, z1, { c: 0.003 });
        cylZ(parts, 'locker-locks', CHROME, zf, zf + 0.006, xb - 0.0325, (ya + yb) / 2 + 0.11, 0.009, 10);
        parts.box('locker-plates', { key: 'metal', tint: '#D8DBDE' }, cx - 0.025, cx + 0.025, yb - 0.11, yb - 0.08, zf, zf + 0.002, { c: 0 });
      }
    },
    'locker-bench': () => {
      // a changing-room bench: three hardwood slats with gaps on two charcoal steel frames of rectangular tube
      const gap = 0.012, sw = (d - 2 * gap) / 3;
      for (let i = 0; i < 3; i++) parts.box('lb-slats', WOOD_ASH, -x1, x1, S - 0.028, S, z0 + i * (sw + gap), z0 + i * (sw + gap) + sw, { c: 0.004, grain: 'x' });
      for (const s2 of [-1, 1]) {
        const fx = s2 * (x1 - 0.14);
        rtube(parts, 'lb-frame', FRAME, [fx, S - 0.045, z0 + 0.01], [fx, S - 0.045, z1 - 0.01], 0.04, 0.034, 0.008);
        rtube(parts, 'lb-frame', FRAME, [fx, 0.02, z0 + 0.01], [fx, 0.02, z1 - 0.01], 0.05, 0.04, 0.01);
        for (const z of [z0 + 0.05, z1 - 0.05]) rtube(parts, 'lb-legs', FRAME, [fx, 0.04, z], [fx, S - 0.06, z], 0.04, 0.04, 0.008);
        for (const z of [z0 + 0.03, z1 - 0.03]) parts.box('lb-feet', RUBBER, fx - 0.03, fx + 0.03, 0, 0.005, z - 0.02, z + 0.02, { c: 0.001 });
      }
    },
    scale: () => {
      // a flat digital scale: a glass platform on a frame with a small window display at the front edge
      parts.box('scale-body', SHROUD_LIGHT, -x1, x1, 0, H - 0.001, z0, z1, { c: 0.004 });
      slab(parts, 'scale-glass', { key: 'granite', tint: '#14181C' }, -x1 + 0.02, x1 - 0.02, H - 0.001, H, z0 + 0.02, z1 - 0.06);
      slab(parts, 'scale-display', SCREEN_GLASS, -0.05, 0.05, H - 0.0, H + 0.0, z1 - 0.045, z1 - 0.012);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) cylY(parts, 'scale-feet', RUBBER, sx * (x1 - 0.03), sz * (z1 - 0.03), 0, 0.004, 0.012, 8);
    },
    fan: () => {
      // a wall-mounted drum fan: a wall plate and a bracket arm, a motor boss, three blades behind a wire guard, a tilt knob
      const r = w / 2, cy = lift + r;
      slab(parts, 'fan-plate', FRAME, -0.08, 0.08, cy - 0.1, cy + 0.1, z0, z0 + 0.012);
      tube(parts, 'fan-arm', FRAME, [0, cy, z0 + 0.012], [0, cy, z0 + 0.12], 0.02);
      const boss = new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12).rotateX(Math.PI / 2).translate(0, cy, z0 + 0.18);
      parts.put('fan-motor', SHROUD, boss);
      for (let i = 0; i < 3; i++) {
        const blade = new THREE.BoxGeometry(r * 0.78, 0.18, 0.008);
        blade.rotateZ((i * Math.PI * 2) / 3 + 0.4);
        blade.translate(0, 0, 0);
        const g = blade.clone();
        g.translate(Math.cos((i * Math.PI * 2) / 3 + 0.4) * r * 0.4, Math.sin((i * Math.PI * 2) / 3 + 0.4) * r * 0.4 + cy, z0 + 0.2);
        parts.put('fan-blades', SHROUD_LIGHT, g);
      }
      // the guard: two rings and radial wires, the front one reaching the item's depth and width
      for (const [z, rr] of [[z0 + 0.12, r - 0.004], [z1 - 0.01, r - 0.004]] as const) parts.put('fan-guard', CHROME, new THREE.TorusGeometry(rr, 0.006, 5, Math.max(16, q.sides * 4)).translate(0, cy, z));
      parts.put('fan-guard', CHROME, new THREE.TorusGeometry(r * 0.55, 0.004, 4, Math.max(14, q.sides * 3)).translate(0, cy, z1 - 0.01));
      for (let i = 0; i < 12; i++) {
        const a = (i * Math.PI) / 6;
        tube(parts, 'fan-guard', CHROME, [Math.cos(a) * (r - 0.004), cy + Math.sin(a) * (r - 0.004), z0 + 0.12], [Math.cos(a) * (r - 0.004), cy + Math.sin(a) * (r - 0.004), z1 - 0.01], 0.003);
        tube(parts, 'fan-guard', CHROME, [Math.cos(a) * (r - 0.004), cy + Math.sin(a) * (r - 0.004), z1 - 0.01], [0, cy, z1 - 0.01], 0.003);
      }
      // extremes: the ring's top and bottom reach lift and lift + 2r exactly
      slab(parts, 'fan-guard', CHROME, -0.01, 0.01, lift, lift + 0.006, z1 - 0.014, z1 - 0.006);
      slab(parts, 'fan-guard', CHROME, -0.01, 0.01, H - 0.006, H, z1 - 0.014, z1 - 0.006);
      slab(parts, 'fan-guard', CHROME, -x1, -x1 + 0.006, cy - 0.01, cy + 0.01, z1 - 0.014, z1 - 0.006);
      slab(parts, 'fan-guard', CHROME, x1 - 0.006, x1, cy - 0.01, cy + 0.01, z1 - 0.014, z1 - 0.006);
      void ACCENT_RED; void pad; void PAD_BLACK;
    },
    tiles: () => {
      // interlocking rubber tiles 50 cm square, 15 mm: one slab of the photographed black-fleck gym rubber, the joints as dark hairlines on top
      parts.box('rubber-tiles', RUBBER_FLOOR, -x1, x1, 0, H, z0, z1, { c: 0.003 });
      const nx = Math.max(1, Math.round(w / 0.5)), nz = Math.max(1, Math.round(d / 0.5));
      const seam: MatSpec = { key: 'dark', tint: '#141517' };
      for (let i = 1; i < nx; i++) { const x = -x1 + (i * w) / nx; parts.put('rubber-tile-joints', seam, new THREE.BoxGeometry(0.003, 0.0008, d - 0.01).translate(x, H + 0.0002, 0)); }
      for (let j = 1; j < nz; j++) { const z = z0 + (j * d) / nz; parts.put('rubber-tile-joints', seam, new THREE.BoxGeometry(w - 0.01, 0.0008, 0.003).translate(0, H + 0.0002, z)); }
    },
  };
  build[v]();
  void S; void SHROUD;
  return parts.done();
}
