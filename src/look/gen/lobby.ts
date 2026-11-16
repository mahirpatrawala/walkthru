// Lobby and corridor pieces (SPEC 16.17): reception desks (straight and L), a visitor seating set, large planters, a letterbox bank, a security desk, a notice
// board, a directory board, a lift-lobby bench, a wall art panel and a queue stanchion pair. Wall pieces carry `liftM`. Sizes are exactly the item's.
import * as THREE from 'three';
import { Parts, role, roleOr } from './core';
import type { GenEnv, GenSize, MatSpec, Roles } from './core';
import { CERAMIC, CHROME, LEAF, SOIL, soft } from './kit';

const LEAF_DARK: MatSpec = { key: LEAF.key, tint: '#2F6A35' };
import { roundedBoxBetween } from '../furniture-parts';
import { ACCENT_BLUE, ACCENT_RED, CONSOLE, FRAME, FRAME_GREY, IRON, PAD_BLACK, SCREEN_GLASS, SHROUD_LIGHT, WOOD_ASH, cylY, slab, tube } from './gymkit';

export const LOBBY_VARIANTS = ['desk', 'desk-l', 'visitor-set', 'planter-round', 'planter-trough', 'letterbox', 'security', 'notice', 'directory', 'bench', 'art', 'stanchion'] as const;
export type LobbyVariant = (typeof LOBBY_VARIANTS)[number];
export interface LobbyParams { variant: LobbyVariant; liftM: number }
export const LOBBY_DEFAULTS: LobbyParams = { variant: 'desk', liftM: 0 };

export function buildLobby(env: GenEnv, size: GenSize, p: LobbyParams, roles: Roles): THREE.Group {
  const { w, d, h: H, s: S } = size;
  const v = (LOBBY_VARIANTS as readonly string[]).includes(p.variant) ? p.variant : 'desk';
  const parts = new Parts(env, `gen:lobby`);
  const x1 = w / 2, z0 = -d / 2, z1 = d / 2;
  const q = env.q;
  const lift = p.liftM ?? 0;
  const wood = role(roles, 'case', 'accent');
  const stone = roleOr(roles, { key: 'granite', tint: '#3A3C40' }, 'top');
  const seg = q.tier === 'low' ? 12 : q.tier === 'medium' ? 20 : 28;
  const wseg = q.tier === 'low' ? 12 : 16;

  /** a reception counter block: a front panel in wood with a vertical groove pattern, a stone transaction top, a raised ledge and a lower staff desk behind */
  const counter = (xa: number, xb: number, za: number, zb: number, deskSide: 'back' | 'none'): void => {
    parts.box('desk-body', wood, xa, xb, 0, 1.03, za, zb, { c: 0.006, grain: 'y' });
    if (q.flutes) for (let x = xa + 0.06; x < xb - 0.04; x += 0.06) slab(parts, 'desk-flutes', { key: 'dark', tint: '#7A6A58' }, x, x + 0.012, 0.08, 0.98, zb, zb + 0.004);
    parts.box('desk-top', stone, xa - 0.02, xb + 0.02, 1.03, 1.07, za, zb + 0.03, { c: 0.004 });
    // the raised ledge at the front: a sloped lip the visitor leans on, at 1.15
    parts.box('desk-ledge', stone, xa - 0.02, xb + 0.02, 1.07, S + 0.1, zb - 0.22, zb + 0.03, { c: 0.004 });
    if (deskSide === 'back') {
      parts.box('desk-staff-top', wood, xa, xb, 0.72, 0.75, za, za + 0.5, { c: 0.004 });
      for (const sx of [xa + 0.04, xb - 0.04]) slab(parts, 'desk-staff-legs', FRAME_GREY, sx - 0.02, sx + 0.02, 0, 0.72, za + 0.04, za + 0.08);
    }
  };

  const build: Record<string, () => void> = {
    desk: () => {
      counter(-x1 + 0.02, x1 - 0.02, z0 + 0.0, z1 - 0.03, 'back');
      // a backlit name panel on the front, a brass plate
      slab(parts, 'desk-sign', { key: 'brass', tint: '#C9A24E' }, -0.35, 0.35, 0.55, 0.65, z1 - 0.03, z1 - 0.025);
    },
    'desk-l': () => {
      // the long counter at the front and a return running back on the left; the staff desk wraps inside
      counter(-x1 + 0.02, x1 - 0.02, z1 - 0.8, z1 - 0.03, 'none');
      counter(-x1 + 0.02, -x1 + 0.82, z0, z1 - 0.8, 'none');
      parts.box('desk-staff-top', wood, -x1 + 0.82, x1 - 0.02, 0.72, 0.75, z1 - 1.3, z1 - 0.8, { c: 0.004 });
      parts.box('desk-staff-top', wood, -x1 + 0.82, -x1 + 1.32, 0.72, 0.75, z0 + 0.05, z1 - 1.3, { c: 0.004 });
      slab(parts, 'desk-sign', { key: 'brass', tint: '#C9A24E' }, -0.35, 0.35, 0.55, 0.65, z1 - 0.03, z1 - 0.025);
    },
    'visitor-set': () => {
      // a 3-seater at the back facing forward, two armchairs on the right and left facing in, a low table between
      const fab = role(roles, 'fabric', 'accent');
      const frame = role(roles, 'legs', 'case', 'handle');
      const seat = (cx: number, cz: number, ww: number, dd: number, rot: number, withArms: boolean): void => {
        const m = new THREE.Matrix4().makeRotationY(rot).setPosition(cx, 0, cz);
        const put = (name: string, mat: MatSpec, g: THREE.BufferGeometry, o = {}): void => parts.put(name, mat, g.applyMatrix4(m), o);
        const b = (x0: number, x1_: number, y0: number, y1_: number, za: number, zb: number): THREE.BufferGeometry => new THREE.BoxGeometry(x1_ - x0, y1_ - y0, zb - za).translate((x0 + x1_) / 2, (y0 + y1_) / 2, (za + zb) / 2);
        const cush = (x0: number, x1_: number, y0: number, y1_: number, za: number, zb: number, r: number): THREE.BufferGeometry => (q.chamfer ? roundedBoxBetween(x0, x1_, y0, y1_, za, zb, Math.min(r, (y1_ - y0) / 2.2, (x1_ - x0) / 2.2, (zb - za) / 2.2), 1) : b(x0, x1_, y0, y1_, za, zb));
        put('vs-base', fab, cush(-ww / 2, ww / 2, 0.12, 0.3, -dd / 2, dd / 2, 0.03), { tile: 0.4 });
        put('vs-seat', fab, cush(-ww / 2 + (withArms ? 0.12 : 0.04), ww / 2 - (withArms ? 0.12 : 0.04), 0.3, 0.45, -dd / 2 + 0.2, dd / 2 - 0.02, 0.04), { tile: 0.4 });
        put('vs-back', fab, cush(-ww / 2 + 0.02, ww / 2 - 0.02, 0.3, H, -dd / 2, -dd / 2 + 0.22, 0.05), { tile: 0.4 });
        if (withArms) for (const s of [-1, 1]) put('vs-arms', fab, cush(s > 0 ? ww / 2 - 0.12 : -ww / 2, s > 0 ? ww / 2 : -ww / 2 + 0.12, 0.12, 0.62, -dd / 2, dd / 2, 0.05), { tile: 0.4 });
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) put('vs-legs', frame, b(sx * (ww / 2 - 0.06) - 0.015, sx * (ww / 2 - 0.06) + 0.015, 0, 0.12, sz * (dd / 2 - 0.06) - 0.015, sz * (dd / 2 - 0.06) + 0.015));
      };
      seat(0, z0 + 0.45, 1.9, 0.9, 0, true);
      seat(-x1 + 0.425, z1 - 0.7, 0.8, 0.85, Math.PI / 2, true);
      seat(x1 - 0.425, z1 - 0.7, 0.8, 0.85, -Math.PI / 2, true);
      // the table
      parts.box('vs-table', stone, -0.45, 0.45, 0.4, 0.44, z1 - 0.5, z1, { c: 0.004 });
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) slab(parts, 'vs-table-legs', frame, sx * 0.42 - 0.015, sx * 0.42 + 0.015, 0, 0.4, (z1 - 0.25) + sz * 0.2 - 0.015, (z1 - 0.25) + sz * 0.2 + 0.015);
    },
    'planter-round': () => {
      const r = w / 2, potH = 0.55;
      cylY(parts, 'planter-pot', roleOr(roles, CERAMIC, 'pot'), 0, 0, 0.02, potH, r, seg);
      cylY(parts, 'planter-pot', roleOr(roles, CERAMIC, 'pot'), 0, 0, 0, 0.02, r - 0.04, seg);
      // a rolled rim, and the soil a hair above the pot's top cap
      parts.put('planter-rim', roleOr(roles, CERAMIC, 'pot'), new THREE.TorusGeometry(r - 0.012, 0.014, 6, seg * 2).rotateX(Math.PI / 2).translate(0, potH, 0));
      cylY(parts, 'planter-soil', SOIL, 0, 0, potH - 0.02, potH + 0.004, r - 0.03, seg);
      // a proper leafy plant: stems from the pot and elongated leaves in two greens, set on a golden-angle spiral, long and drooping low, short and upright at the crown
      const n = q.tier === 'low' ? 14 : q.tier === 'medium' ? 36 : 54;
      const topY = H - 0.1;
      const lsegW = q.tier === 'low' ? 5 : 7, lsegH = q.tier === 'low' ? 3 : 4;
      const leaves: { g: THREE.BufferGeometry; dark: boolean }[] = [];
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const ang = i * 2.399963;
        const hash = (Math.sin(i * 91.7) * 43758.5453) % 1, hh = Math.abs(hash);
        const baseY = potH + 0.12 + (topY - potH - 0.12) * (0.2 + 0.8 * t);
        const reach = (r * 0.5 + 0.18) * (1 - 0.55 * t) * (0.7 + 0.5 * hh);
        const len = 0.2 + 0.14 * (1 - t) + 0.05 * hh, wid = 0.075 + 0.025 * hh;
        const pitch = (0.5 - 0.55 * t) + 0.25 * (hh - 0.5);            // radians above horizontal: drooping at the bottom, up at the top
        const g = new THREE.SphereGeometry(1, lsegW, lsegH).scale(wid / 2, 0.012, len / 2);
        g.translate(0, 0, len / 2);                                       // the leaf's base at the origin, pointing +z
        g.rotateX(-pitch);
        g.rotateY(ang);
        g.translate(Math.sin(ang) * reach * 0.35, baseY, Math.cos(ang) * reach * 0.35);
        leaves.push({ g, dark: i % 3 === 0 });
      }
      // the plant stays inside the row's box at every tier: the crown reaches exactly its height, no leaf passes the pot's width
      const box = new THREE.Box3();
      for (const l of leaves) { l.g.computeBoundingBox(); box.union(l.g.boundingBox!); }
      const reachXZ = Math.max(Math.abs(box.min.x), box.max.x, Math.abs(box.min.z), box.max.z, 1e-6);
      const kxz = Math.min(1, (r - 0.002) / reachXZ), ky = (H - box.min.y) / Math.max(1e-6, box.max.y - box.min.y);
      for (const l of leaves) {
        l.g.translate(0, -box.min.y, 0).scale(kxz, ky, kxz).translate(0, box.min.y, 0);
        parts.put('plant-leaves', l.dark ? LEAF_DARK : LEAF, l.g, { tile: 0.3 });
      }
      for (let k = 0; k < 5; k++) {
        const a = k * 1.256;
        tube(parts, 'plant-stems', { key: 'wood', tint: '#6B5640' }, [0, potH, 0], [Math.sin(a) * 0.1, topY - 0.25 + (k % 2) * 0.12, Math.cos(a) * 0.1], 0.012);
      }
    },
    'planter-trough': () => {
      parts.box('planter-pot', roleOr(roles, CERAMIC, 'pot'), -x1, x1, 0, 0.45, z0, z1, { c: 0.008 });
      slab(parts, 'planter-soil', SOIL, -x1 + 0.03, x1 - 0.03, 0.43, 0.452, z0 + 0.03, z1 - 0.03);
      const blob = (cx: number, cy: number, cz: number, rx: number, ry: number, rz: number): void => { parts.put('plant-leaves', LEAF, new THREE.SphereGeometry(1, wseg, 6).scale(rx, ry, rz).translate(cx, cy, cz), { tile: 0.3 }); };
      const n = 5;
      for (let i = 0; i < n; i++) {
        const x = -x1 + 0.17 + (i / (n - 1)) * (w - 0.34);
        const hh = (H - 0.45) * (0.7 + 0.3 * (i % 2));
        blob(x, 0.45 + hh * 0.5, 0, 0.17, hh * 0.5, d / 2 - 0.05);
      }
      blob(0, H - 0.2, 0, 0.2, 0.2, d / 2 - 0.05);
    },
    letterbox: () => {
      // a bank of steel letterboxes: 6 across, 5 high, each with a number, a slot and a lock, on a wall plate
      const cols = 6, rows = 5, top = H, bot = lift;
      const cw = w / cols, ch = (top - bot) / rows;
      parts.box('lb-body', { key: 'laminate', tint: '#7E8388' }, -x1, x1, bot, top, z0, z1 - 0.004, { c: 0.002 });
      for (let c = 0; c < cols; c++) for (let r = 0; r < rows; r++) {
        const xa = -x1 + c * cw + 0.006, xb = -x1 + (c + 1) * cw - 0.006, ya = bot + r * ch + 0.006, yb = bot + (r + 1) * ch - 0.006;
        slab(parts, 'lb-doors', { key: 'laminate', tint: '#B9BEC3' }, xa, xb, ya, yb, z1 - 0.004, z1);
        slab(parts, 'lb-slots', IRON, (xa + xb) / 2 - 0.055, (xa + xb) / 2 + 0.055, yb - 0.04, yb - 0.032, z1, z1 + 0.002);
        cylY(parts, 'lb-locks', CHROME, (xa + xb) / 2, z1 + 0.003, ya + 0.025, ya + 0.04, 0.008, 6);
        slab(parts, 'lb-numbers', ACCENT_BLUE, (xa + xb) / 2 - 0.025, (xa + xb) / 2 + 0.025, ya + 0.06, ya + 0.08, z1, z1 + 0.002);
      }
    },
    security: () => {
      // a desk with a modesty front, a wide top and three monitors on arms
      parts.box('sec-body', wood, -x1 + 0.02, x1 - 0.02, 0, 0.72, z0 + 0.1, z1 - 0.03, { c: 0.006, grain: 'y' });
      parts.box('sec-top', stone, -x1, x1, 0.72, 0.76, z0, z1, { c: 0.004 });
      for (const [i, cx] of [-0.5, 0, 0.5].entries()) {
        tube(parts, 'sec-arms', FRAME_GREY, [cx, 0.76, z0 + 0.25], [cx, H - 0.18, z0 + 0.25], 0.012);
        parts.box('sec-monitors', CONSOLE, cx - 0.22, cx + 0.22, H - 0.3, H, z0 + 0.22, z0 + 0.27, { c: 0.004 });
        slab(parts, 'sec-screens', SCREEN_GLASS, cx - 0.2, cx + 0.2, H - 0.28, H - 0.02, z0 + 0.27, z0 + 0.272);
        void i;
      }
      slab(parts, 'sec-keyboard', CONSOLE, -0.2, 0.2, 0.76, 0.78, z0 + 0.5, z0 + 0.72);
    },
    notice: () => {
      parts.box('notice-frame', WOOD_ASH, -x1, x1, lift, H, z0, z1 - 0.004, { c: 0.002 });
      slab(parts, 'notice-cork', { key: 'wood', tint: '#B98A55' }, -x1 + 0.03, x1 - 0.03, lift + 0.03, H - 0.03, z1 - 0.012, z1);
      const sheets: [number, number, number, number, string][] = [[-0.45, 0.2, 0.28, 0.38, '#F4F2EC'], [-0.1, 0.28, 0.22, 0.3, '#E8D9A0'], [0.18, 0.18, 0.3, 0.4, '#F4F2EC'], [0.4, 0.4, 0.2, 0.28, '#BFD6E6'], [-0.35, 0.58, 0.22, 0.3, '#EAC8C0'], [0.0, 0.55, 0.3, 0.2, '#F4F2EC']];
      for (const [cx, cy, sw, sh, tint] of sheets) slab(parts, 'notice-sheets', { key: 'laminate', tint }, cx - sw / 2, cx + sw / 2, lift + 0.05 + cy - sh / 2 + 0.1, lift + 0.05 + cy + sh / 2 + 0.1, z1, z1 + 0.003);
    },
    directory: () => {
      // a dark board with a header band and rows of name strips in two columns
      parts.box('dir-frame', FRAME, -x1, x1, lift, H, z0, z1 - 0.004, { c: 0.002 });
      slab(parts, 'dir-face', { key: 'laminate', tint: '#23282E' }, -x1 + 0.025, x1 - 0.025, lift + 0.025, H - 0.025, z1 - 0.004, z1);
      slab(parts, 'dir-header', { key: 'brass', tint: '#C9A24E' }, -x1 + 0.05, x1 - 0.05, H - 0.16, H - 0.07, z1, z1 + 0.003);
      const rows = 9;
      for (let c = 0; c < 2; c++) for (let r = 0; r < rows; r++) {
        const xa = -x1 + 0.06 + c * (w / 2 - 0.02), xb = xa + w / 2 - 0.1;
        const y = H - 0.26 - r * ((H - lift - 0.4) / rows);
        slab(parts, 'dir-numbers', { key: 'brass', tint: '#C9A24E' }, xa, xa + 0.07, y, y + 0.025, z1, z1 + 0.003);
        slab(parts, 'dir-names', SHROUD_LIGHT, xa + 0.1, xb - 0.05 * ((r + c) % 3), y, y + 0.025, z1, z1 + 0.003);
      }
    },
    bench: () => {
      const fab = role(roles, 'fabric', 'accent');
      parts.put('bench-seat', fab, soft(env, -x1, x1, S - 0.1, S, z0, z1, 0.02), { tile: 0.4 });
      slab(parts, 'bench-base', FRAME, -x1 + 0.03, x1 - 0.03, S - 0.14, S - 0.1, z0 + 0.03, z1 - 0.03);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) tube(parts, 'bench-legs', FRAME, [sx * (x1 - 0.1), 0, sz * (z1 - 0.08)], [sx * (x1 - 0.1), S - 0.14, sz * (z1 - 0.08)], 0.016);
    },
    art: () => {
      // three canvases in one frame, abstract blocks of colour
      parts.box('art-frame', { key: 'wood', tint: '#3A2C22' }, -x1, x1, lift, H, z0, z1 - 0.004, { c: 0.002 });
      const tints = ['#C9583C', '#E7B954', '#2F5F6E', '#EFE7D8', '#8DA68B'];
      const nx = 3, cw = (w - 0.1) / nx;
      for (let i = 0; i < nx; i++) {
        const xa = -x1 + 0.05 + i * cw + 0.01, xb = -x1 + 0.05 + (i + 1) * cw - 0.01;
        slab(parts, 'art-canvas', { key: 'laminate', tint: tints[i + 2] }, xa, xb, lift + 0.05, H - 0.05, z1 - 0.01, z1);
        slab(parts, 'art-blocks', { key: 'laminate', tint: tints[i] }, xa + 0.08, xb - 0.1, lift + 0.2 + i * 0.1, lift + 0.2 + i * 0.1 + 0.28, z1, z1 + 0.002);
        slab(parts, 'art-blocks', { key: 'laminate', tint: tints[(i + 1) % 5] }, xa + 0.14, xb - 0.04, H - 0.4 - i * 0.05, H - 0.15 - i * 0.05, z1, z1 + 0.002);
      }
    },
    stanchion: () => {
      // two chrome posts on round bases with a ball head and a webbing belt between them at 85 cm
      const r = 0.16;
      for (const sx of [-1, 1]) {
        const cx = sx * (x1 - r);
        cylY(parts, 'stanchion-bases', CHROME, cx, 0, 0, 0.025, r, 20);
        cylY(parts, 'stanchion-posts', CHROME, cx, 0, 0.025, H - 0.05, 0.025, 12);
        parts.put('stanchion-heads', CHROME, new THREE.SphereGeometry(0.05, 12, 8).translate(cx, H - 0.05, 0));
        cylY(parts, 'stanchion-collars', FRAME, cx, 0, 0.8, 0.9, 0.032, 12);
      }
      slab(parts, 'stanchion-belt', ACCENT_RED, -x1 + r, x1 - r, 0.82, 0.88, -0.004, 0.004);
      void PAD_BLACK;
    },
  };
  build[v]();
  void H; void d;
  return parts.done();
}
