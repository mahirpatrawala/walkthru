import { describe, expect, it } from 'vitest';
import { cellCentre, cellIndex, cellValue, cloneGrid, createGrid } from '../src/core/grid-codec';
import { GRID_CELL_M, GRID_VOID } from '../src/types';

describe('grid codec', () => {
  const g = createGrid(-1, -2, 10, 8);
  it('creates a free grid with the standard cell size', () => {
    expect(g.cellM).toBe(GRID_CELL_M);
    expect(g.cells.length).toBe(80);
    expect(g.cells.every((v) => v === 0)).toBe(true);
    expect(createGrid(0, 0, 2, 2, GRID_VOID).cells.every((v) => v === 255)).toBe(true);
  });
  it('indexes j * nx + i, -1 outside', () => {
    expect(cellIndex(g, -1 + 0.025, -2 + 0.025)).toBe(0);
    expect(cellIndex(g, -1 + 0.075, -2 + 0.075)).toBe(1 * 10 + 1);
    expect(cellIndex(g, -1.01, -2)).toBe(-1);
    expect(cellIndex(g, -1 + 10 * GRID_CELL_M + 0.001, -2)).toBe(-1);
    expect(cellIndex(g, -1, -2 + 8 * GRID_CELL_M + 0.001)).toBe(-1);
  });
  it('cellValue is GRID_VOID outside and reads the cell inside', () => {
    expect(cellValue(g, 100, 100)).toBe(GRID_VOID);
    g.cells[cellIndex(g, -0.9, -1.9)] = 77;
    expect(cellValue(g, -0.9, -1.9)).toBe(77);
  });
  it('cellCentre round-trips through cellIndex', () => {
    for (const [i, j] of [[0, 0], [3, 5], [9, 7]]) {
      const c = cellCentre(g, i, j);
      expect(cellIndex(g, c.x, c.z)).toBe(j * g.nx + i);
    }
  });
  it('cloneGrid copies the cells', () => {
    const c = cloneGrid(g);
    c.cells[0] = 9;
    expect(g.cells[0]).toBe(0);
    expect(c.nx).toBe(g.nx);
  });
});
