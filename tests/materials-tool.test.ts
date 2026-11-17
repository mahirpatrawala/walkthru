// The Materials tool's badge (src/buyer/materials-tool.ts): it says the level that is drawn, and says so when that is not the one chosen.
import { describe, expect, it } from 'vitest';
import { materialsBadge } from '../src/buyer/materials-tool';
import { REALISM_CHOICE, REALISM_LEVELS, REALISM_NOTE } from '../src/look/realistic';

describe('materials badge', () => {
  it('reads Off, 1K or 2K as chosen', () => {
    expect(materialsBadge('off', 'off')).toEqual({ text: 'Off', kept: false });
    expect(materialsBadge('1k', '1k')).toEqual({ text: '1K', kept: false });
    expect(materialsBadge('2k', '2k')).toEqual({ text: '2K', kept: false });
  });
  it('shows what is drawn when the device kept it smoother than the choice, and flags it', () => {
    expect(materialsBadge('2k', '1k')).toEqual({ text: '1K', kept: true });
    expect(materialsBadge('1k', 'off')).toEqual({ text: 'Off', kept: true });
  });
  it('an Off choice never reads as kept', () => { expect(materialsBadge('off', '1k').kept).toBe(false); });
  it('every level has a label and an honest note', () => {
    for (const lv of REALISM_LEVELS) { expect(REALISM_CHOICE[lv].length).toBeGreaterThan(0); expect(REALISM_NOTE[lv].length).toBeGreaterThan(20); }
  });
});
