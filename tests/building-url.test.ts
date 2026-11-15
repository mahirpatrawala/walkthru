import { describe, expect, it } from 'vitest';
import { buildingUrl, parseBuildingUrl } from '../src/building/url';

describe('the address of a place in a building', () => {
  it('round-trips a space', () => {
    for (const u of [{ building: 'sample-tower', space: 'f2-201' }, { building: 'sample-tower-empty', space: 'st-1-gym' }, { building: 'a', space: null }]) {
      expect(parseBuildingUrl(buildingUrl(u).slice(1))).toEqual(u);
    }
    expect(buildingUrl({ building: 'sample-tower', space: 'f3-302' })).toBe('/?building=sample-tower&space=f3-302');
    expect(buildingUrl({ building: 'sample-tower', space: null })).toBe('/?building=sample-tower');
  });
  it('is shareable: any order, other parameters kept out of the way', () => {
    expect(parseBuildingUrl('?space=f2-201&building=sample-tower&debug=1')).toEqual({ building: 'sample-tower', space: 'f2-201' });
  });
  it('a building alone is its map page', () => {
    expect(parseBuildingUrl('?building=sample-tower')).toEqual({ building: 'sample-tower', space: null });
  });
  it('rejects a building that is not an id, and drops a space that is not', () => {
    expect(parseBuildingUrl('')).toBeNull();
    expect(parseBuildingUrl('?scene=test-flat')).toBeNull();
    expect(parseBuildingUrl('?building=../etc')).toBeNull();
    expect(parseBuildingUrl('?building=Sample Tower')).toBeNull();
    expect(parseBuildingUrl('?building=sample-tower&space=../x')).toEqual({ building: 'sample-tower', space: null });
  });
  it('a ?scene= link is not a building link', () => {
    expect(parseBuildingUrl('?scene=st-lobby')).toBeNull();
  });
});
