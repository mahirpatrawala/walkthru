// C12b: the Hershey stroke fonts the glyph reader matches against (SPEC 17.5 item 2): pinned, recorded, and rendering what it should.
import { describe, expect, it } from 'vitest';
import { HERSHEY_FACES, HERSHEY_SOURCE } from '../src/understand/hershey-data';
import { CAP_H, FACES, fontOf, hersheyProvenance, layoutString, stringWidth } from '../src/understand/hershey';

describe('Hershey data', () => {
  it('is pinned to one commit and every face records the sha256 of its file', () => {
    expect(HERSHEY_SOURCE.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(HERSHEY_SOURCE.noticeSha256).toMatch(/^[0-9a-f]{64}$/);
    const p = hersheyProvenance();
    expect(p.faces.map((f) => f.face).sort()).toEqual(['complex', 'duplex', 'simplex']);
    for (const f of p.faces) { expect(f.sha256).toMatch(/^[0-9a-f]{64}$/); expect(f.glyphs).toBe(95); expect(f.file).toMatch(/\.jhf$/); }
  });
  it('the acknowledgements travel with the data', async () => {
    const fs = await import('node:fs');
    const text = fs.readFileSync(new URL('../src/understand/hershey-data.ts', import.meta.url), 'utf8');
    expect(text).toContain('Dr. A. V. Hershey');
    expect(text).toContain('James Hurt');
    expect(text).toContain('Public domain');
  });
  it('holds every printable ASCII character in each face, with a capital height of 21 units', () => {
    for (const face of FACES) {
      const font = fontOf(face);
      for (let c = 33; c <= 126; c++) expect(font.has(String.fromCharCode(c)), `${face} ${String.fromCharCode(c)}`).toBe(true);
      for (const ch of '0123456789ABXHEI') { const g = font.get(ch)!; expect(g.box[3] - g.box[1], `${face} ${ch}`).toBeGreaterThanOrEqual(20); expect(g.box[3], `${face} ${ch}`).toBeLessThanOrEqual(CAP_H + 0.5); }
      expect(HERSHEY_FACES[face].lines.length).toBeGreaterThanOrEqual(95);
    }
  });
  it('has the fraction glyph the dimension strings need', () => {
    for (const face of FACES) { const g = fontOf(face).get('½')!; expect(g.strokes.length).toBeGreaterThanOrEqual(3); expect(g.advance).toBeGreaterThan(15); }
  });
});

describe('layout', () => {
  it('a string is as wide as its advances, slant leaves the baseline alone, and widthScale stretches x only', () => {
    const o = { capH: 10.5, face: 'simplex' as const, slantDeg: 0, widthScale: 1 };
    expect(stringWidth('11', o)).toBeCloseTo((fontOf('simplex').get('1')!.advance * 2 * 10.5) / CAP_H, 6);
    const wide = layoutString('8', { ...o, widthScale: 1.2 }).flat();
    const plain = layoutString('8', o).flat();
    expect(Math.max(...wide.map((p) => p[0]))).toBeCloseTo(Math.max(...plain.map((p) => p[0])) * 1.2, 6);
    expect(Math.max(...wide.map((p) => p[1]))).toBeCloseTo(Math.max(...plain.map((p) => p[1])), 6);
    const lean = layoutString('1', { ...o, slantDeg: 15 }).flat();
    expect(Math.min(...lean.map((p) => p[1]))).toBeCloseTo(0, 6);
    expect(Math.max(...lean.map((p) => p[0]))).toBeGreaterThan(Math.max(...layoutString('1', o).flat().map((p) => p[0])));
  });
});
