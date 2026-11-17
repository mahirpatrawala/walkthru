import { it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CM, fakeInput, person } from './motion-helpers';
import { loadScene, DoorSim } from './helpers/nav-sim';
import { truthOf, bodyPenetration, bonePenetration } from './helpers/body-sim';
import { stepLocomotion, resetLocomotion } from '../src/engine/locomotion';
import { rasterizeLayout, stampFurniture } from '../src/core/layout-raster';
import { bodyGridOf } from '../src/core/doors';
import { circleFree } from '../src/core/grid-query';
import { pointInPolygon } from '../src/core/geometry';
import type { Character } from '../src/engine/character';
const DT = 1 / 30;
const GUARD = !process.env.NOGUARD;
it('sweep', async () => {
  for (const scene of ['test-tower-flat-3bhk-a']) {
    const prop = loadScene(scene);
    const tr = truthOf(prop);
    const statics = stampFurniture(rasterizeLayout(prop.layout), prop.furniture);
    const grid = new DoorSim(prop.layout, statics).stamp(statics);
    const body = bodyGridOf(prop.layout)(grid);
    const people: Record<string, Character> = {};
    for (const b of ['man', 'woman', 'elder', 'child'] as const) { people[b] = await person(b); people[b].setHeight(DEFAULT_CM[b] / 100, '#fff'); if (GUARD) people[b].setBodyGuard(() => body); }
    const others = ['woman', 'elder', 'child'];
    let run = 0, frames = 0;
    const worst: Record<string, { depth: number; note: string }> = {};
    let maxResid = 0, maxShift = 0, maxStep = 0;
    const t0 = Date.now();
    for (const room of prop.layout.rooms) {
      const poly = room.polygon;
      for (let e = 0; e < poly.length; e++) {
        const a = poly[e], b = poly[(e + 1) % poly.length];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        if (len < 0.3) continue;
        const dir = { x: (b.x - a.x) / len, z: (b.z - a.z) / len };
        let n = { x: -dir.z, z: dir.x };
        const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
        if (!pointInPolygon({ x: mid.x + n.x * 0.05, z: mid.z + n.z * 0.05 }, poly)) n = { x: -n.x, z: -n.z };
        for (const f of len > 1.6 ? [0.2, 0.5, 0.8] : [0.5]) {
          const at0 = { x: a.x + dir.x * len * f, z: a.z + dir.z * len * f };
          let start = null as null | { x: number; z: number };
          for (const d of [0.8, 0.6, 0.45, 0.32]) { const p = { x: at0.x + n.x * d, z: at0.z + n.z * d }; if (circleFree(grid, p.x, p.z, 0.22)) { start = p; break; } }
          if (!start) continue;
          for (const [ang, jog] of [[0, false], [40, false], [-40, false], [70, false], [0, true]] as [number, boolean][]) {
            const who = [['man', people.man] as const, [others[run % 3], people[others[run % 3]]] as const];
            run++;
            for (const [name, ch] of who) {
              const r = ang * Math.PI / 180;
              const hx = -n.x * Math.cos(r) + n.z * Math.sin(r), hz = -n.z * Math.cos(r) - n.x * Math.sin(r);
              resetLocomotion(ch);
              ch.position = { ...start }; ch.yawDeg = Math.atan2(hx, hz) * 180 / Math.PI;
              (ch as any).guard.reset();
              const input = fakeInput(); input.set(-hx, hz, jog);
              let prev = { x: start.x, z: start.z };
              for (let i = 0; i < 66; i++) {
                stepLocomotion(ch, input, 0, grid, DT);
                ch.update(DT);
                frames++;
                const fit = ch.bodyFit;
                maxResid = Math.max(maxResid, fit.residualM); maxShift = Math.max(maxShift, Math.hypot(fit.shiftX, fit.shiftZ));
                const drawn = { x: ch.position.x + fit.shiftX, z: ch.position.z + fit.shiftZ };
                if (i > 0) maxStep = Math.max(maxStep, Math.hypot(drawn.x - prev.x, drawn.z - prev.z));
                prev = drawn;
                if (i % 2) continue;
                const h = bodyPenetration(ch, tr, { stride: 5 });
                const kind = h.what.split(' ')[0] || 'none';
                const key = `${name}:${kind}`;
                if (h.depth > (worst[key]?.depth ?? 0)) worst[key] = { depth: h.depth, note: `${room.id} e${e} f${f} ang${ang} jog${jog} t${(i * DT).toFixed(2)} ${h.what} ${h.mesh}@${h.at.map((v) => v.toFixed(2))} pos ${ch.position.x.toFixed(2)},${ch.position.z.toFixed(2)} yaw ${ch.yawDeg.toFixed(0)} clip ${(ch as any).currentClip} fit ${JSON.stringify(fit)}` };
              }
            }
          }
        }
      }
    }
    console.log(`SWEEP ${scene} runs ${run} frames ${frames} in ${((Date.now() - t0) / 1000).toFixed(0)}s maxResid ${(maxResid * 100).toFixed(1)}cm maxShift ${(maxShift * 100).toFixed(1)}cm maxDrawnStep ${(maxStep * 100).toFixed(1)}cm`);
    for (const [k, v] of Object.entries(worst).sort()) console.log(`SWEEP ${k.padEnd(18)} ${(v.depth * 100).toFixed(1)}cm ${v.note}`);
  }
}, 1800000);
