import { describe, expect, it } from 'vitest';
import { chairPose } from '../src/core/poses';
import { boxAxes } from '../src/core/geometry';
import { chairCheck, seatHeightVerdict, sofaCheck } from '../src/core/checks';
import { buildSeats } from '../src/buyer/seats';
import { nearestInteractable } from '../src/buyer/store';
import { parseDesigns } from '../src/look/designs';
import { stampFurniture } from '../src/core/layout-raster';
import { SIT_HIP_BACK_RATIO, SIT_SEAT_RATIO } from '../src/types';
import type { FurnitureItem, Grid } from '../src/types';

const desk: FurnitureItem = { id: 'desk-1', source: 'real', kind: 'counter', label: 'Desk', box: { cx: 2, cz: -1, w: 1.2, d: 0.6, yawDeg: 270 }, heightM: 0.75, surfaceHeightM: 0.75 };
const dec = (extra: object = {}) => ({ id: 'ch', look: 'chair', tiedTo: 'desk-1', offset: { x: 0, z: 0.34 }, faceItem: true, ...extra });
const file = (decor: object[]) => parseDesigns({ version: 1, source: 't', items: {}, decor });

describe('chair seats', () => {
  it('places the chair at the desk front, facing the desk, standard seat height with honest card', () => {
    const s = buildSeats(file([dec()]), [desk]);
    expect(s.seats).toHaveLength(1);
    const c = s.seats[0];
    // desk yaw 270: front a = (-1, 0); chair centre 0.3 + 0.34 in front; faces back at the desk (yaw 90, a = (1, 0))
    expect(c.item.box.cx).toBeCloseTo(2 - 0.64, 6);
    expect(c.item.box.cz).toBeCloseTo(-1, 6);
    expect(c.item.box.yawDeg).toBe(90);
    expect(c.seatSource).toBe('standard');
    expect(c.seatM).toBe(0.45);
    const card = s.card(c.item, 1.75)!;
    expect(card.footer).toBe('Seat height 45 cm (standard swivel chair, not from the drawing).');
    expect(card.headline).toBe('Seat height 45 cm suits you.');
  });
  it('uses a drawn seat height only when it carries a source', () => {
    const noSrc = buildSeats(file([dec({ seatHeightM: 0.5 })]), [desk]);
    expect(noSrc.seats[0].seatSource).toBe('standard');
    const withSrc = buildSeats(file([dec({ seatHeightM: 0.5, sources: { seatHeightM: { page: 2, sheet: 'S1', text: 'SH 500' } } })]), [desk]);
    expect(withSrc.seats[0].seatSource).toBe('drawing');
    expect(withSrc.seats[0].seatM).toBe(0.5);
    expect(withSrc.card(withSrc.seats[0].item, 1.75)!.footer).toBe('Seat height 50 cm, from the drawing (page 2, sheet S1).');
  });
  it('skips chairs whose host is missing; no designs gives no seats', () => {
    expect(buildSeats(file([dec({ tiedTo: 'nope' })]), [desk]).seats).toHaveLength(0);
    expect(buildSeats(null, [desk]).seats).toHaveLength(0);
  });
  it('the side variant is a side chair with its own standard', () => {
    const s = buildSeats(file([dec({ variant: 'side' })]), [desk]);
    expect(s.seats[0].item.label).toBe('Side chair');
    expect(s.card(s.seats[0].item, 1.75)!.footer).toContain('standard side chair');
  });
  it('chairPose: hips over the seat, facing the chair front, seat height from the seat', () => {
    for (const H of [1.6, 1.9]) {
      const box = { cx: 1.36, cz: -1, w: 0.5, d: 0.5, yawDeg: 90 };
      const p = chairPose(box, 0.45, H);
      const { a } = boxAxes(box);
      const hipX = p.root.x - a.x * SIT_HIP_BACK_RATIO * H, hipZ = p.root.z - a.z * SIT_HIP_BACK_RATIO * H;
      expect(Math.hypot(hipX - box.cx, hipZ - box.cz)).toBeLessThan(0.05);
      expect(p.yawDeg).toBe(90);
      expect(p.rootY).toBeCloseTo(Math.max(-0.02, 0.45 - SIT_SEAT_RATIO * H), 9);
    }
  });
  it('the seat is found by walking up to it, nearer than the desk behind it', () => {
    const s = buildSeats(file([dec()]), [desk]);
    const n = nearestInteractable([desk, ...s.items()], { x: 0.9, z: -1 });
    expect(n?.item.id).toBe('seat:ch');
    expect(s.isSeat(n!.item)).toBe(true);
  });
  it('its footprint blocks the grid like furniture', () => {
    const s = buildSeats(file([dec()]), [desk]);
    const g: Grid = { cellM: 0.05, originX: -3, originZ: -3, nx: 120, nz: 120, cells: new Uint8Array(120 * 120) };
    const out = stampFurniture(g, s.obstacles().map((o, i) => ({ id: `t${i}`, source: 'virtual' as const, kind: 'wardrobe' as const, label: 't', box: o.box, heightM: o.heightM, surfaceHeightM: o.heightM })));
    const k = (x: number, z: number) => Math.floor((z - -3) / 0.05) * 120 + Math.floor((x - -3) / 0.05);
    expect(out.cells[k(1.36, -1)]).toBeGreaterThan(0);
    expect(out.cells[k(0.5, -1)]).toBe(0);
  });
  it('reuses the sofa seat-height rule and leaves the sofa card unchanged', () => {
    expect(seatHeightVerdict(0.45, 1.6).tone).toBe('good');
    expect(seatHeightVerdict(0.55, 1.6).line).toBe('Seat height 55 cm is high. Your feet may not rest flat.');
    expect(seatHeightVerdict(0.3, 1.9).line).toBe('Seat height 30 cm is low. Your knees sit above your hips.');
    expect(sofaCheck(2, 0.42, 1.75, 'Sofa')).toEqual({ title: 'Sofa · 200 cm wide', tone: 'good', headline: 'Seats 3.', lines: ['Seat height 42 cm suits you.'] });
    expect(chairCheck(0.5, 0.5, 0.45, 1.75, 'Chair', 'x').tone).toBe('good');
  });
});
