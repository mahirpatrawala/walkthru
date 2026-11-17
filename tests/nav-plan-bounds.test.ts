// The floor-plan card (SPEC 2.7): nothing it draws may leave the plan, whatever the scale it was measured at. A live site once showed a plan-sized white
// disc over the card header (a CSS filter length on an SVG element is in plan metres). Every scene's plan is drawn here; every shape must lie inside its
// viewBox, and the walker's marks, at any room and any scale, must stay small and inside it.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateProperty } from '../src/core/layout-validate';
import { planSvg } from '../src/start/plan-svg';
import { liveMark } from '../src/buyer/nav/nav-model';

const ROOT = path.resolve(__dirname, '..');
const SCENES = path.join(ROOT, 'public/scenes');
const ids = fs.readdirSync(SCENES).filter((d) => fs.existsSync(path.join(SCENES, d, 'property.json')));

describe('the minimap draws nothing outside its plan', () => {
  it('has scenes to check', () => { expect(ids.length).toBeGreaterThan(10); });
  for (const id of ids) {
    it(`${id}: every drawn shape is inside the viewBox, and the walker's marks stay small inside it in every room at any scale`, () => {
      const p = validateProperty(JSON.parse(fs.readFileSync(path.join(SCENES, id, 'property.json'), 'utf8')));
      const pic = planSvg(p.layout, {}, { idPrefix: 't', title: id });
      const drawn = pic.svg.replace(/<defs>.*?<\/defs>/s, ''); // the hatch pattern's own tile is not in plan space
      const vb = /viewBox="([^"]+)"/.exec(pic.svg)![1].split(' ').map(Number);
      const [x0, z0, w, h] = vb;
      const eps = 1e-6;
      const inside = (x: number, z: number): boolean => x >= x0 - eps && x <= x0 + w + eps && z >= z0 - eps && z <= z0 + h + eps;
      for (const m of drawn.matchAll(/points="([^"]+)"/g)) {
        for (const pt of m[1].trim().split(/\s+/)) { const [x, z] = pt.split(',').map(Number); expect(inside(x, z), `${pt} of ${id}`).toBe(true); }
      }
      for (const m of drawn.matchAll(/x1="([^"]+)" y1="([^"]+)" x2="([^"]+)" y2="([^"]+)"/g)) {
        expect(inside(+m[1], +m[2]) && inside(+m[3], +m[4]), `line of ${id}`).toBe(true);
      }
      for (const room of p.layout.rooms) {
        const c = { x: room.polygon.reduce((a, q) => a + q.x, 0) / room.polygon.length, z: room.polygon.reduce((a, q) => a + q.z, 0) / room.polygon.length };
        for (const k of [0.01, 0.5, 1, 4, 8, 25, 60, 200, 5000, NaN, 0]) {
          const g = liveMark(k, w, h);
          expect(g.r, `r at ${k}`).toBeGreaterThan(0);
          expect(g.halo).toBeGreaterThanOrEqual(g.r);
          expect(g.halo, `halo at ${k}`).toBeLessThanOrEqual(Math.min(w, h) * 0.1 + 1e-9);
          expect(g.stroke).toBeLessThanOrEqual(g.r * 0.5 + 1e-9);
          expect(g.cone, `cone at ${k}`).toBeLessThanOrEqual(Math.max(w, h) * 0.3 + 1e-9);
          // the dot sits in the plan; at any real scale (4 px per metre and up) it is a few pixels across, never a metre-sized disc (an edge room's halo may touch the plan's edge, where the card clips it)
          expect(inside(c.x, c.z), `${room.id} centre`).toBe(true);
          if (k >= 4 && k <= 200) { expect(g.r * k).toBeLessThanOrEqual(5.01); expect(g.halo * k).toBeLessThanOrEqual(8.01); expect(g.cone * k).toBeLessThanOrEqual(30.01); }
        }
      }
    });
  }
});
