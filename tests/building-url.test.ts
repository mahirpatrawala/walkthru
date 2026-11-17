import { describe, expect, it } from 'vitest';
import { buildingUrl, parseBuildingUrl } from '../src/building/url';

describe('the address of a place in a building', () => {
  it('round-trips a space', () => {
    for (const u of [{ building: 'sample-tower', space: 'f2-201' }, { building: 'sample-tower-empty', space: 'gym' }, { building: 'a', space: null }]) {
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
    expect(parseBuildingUrl('?scene=test-tower-lobby')).toBeNull();
  });
});

describe('the display parameters go with the viewer (a kiosk that reloads is still a kiosk)', () => {
  it('carries kiosk, idle, chrome, autohide, units and the switches, and nothing about the place', () => {
    const carry = '?building=old&space=old-space&at=1,2,3&cam=first&view=doll&kiosk=1&idle=5&chrome=always&units=m2&debug=1&junk=1';
    expect(buildingUrl({ building: 'sample-tower', space: 'f3-302' }, carry)).toBe('/?building=sample-tower&space=f3-302&kiosk=1&idle=5&chrome=always&units=m2&debug=1');
    expect(buildingUrl({ building: 'sample-tower', space: null }, '')).toBe('/?building=sample-tower');
  });
});
