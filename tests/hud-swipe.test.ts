import { describe, expect, it } from 'vitest';
import { swipeOutcome } from '../src/buyer/hud';

describe('swiping the card away', () => {
  const W = 360, H = 120;
  it('a long drag sideways throws it that way', () => {
    expect(swipeOutcome(130, 4, 600, W, H)).toEqual({ x: 1, y: 0 });
    expect(swipeOutcome(-130, 4, 600, W, H)).toEqual({ x: -1, y: 0 });
  });
  it('a long drag down throws it down', () => {
    expect(swipeOutcome(5, 70, 600, W, H)).toEqual({ x: 0, y: 1 });
  });
  it('a quick flick is enough', () => {
    expect(swipeOutcome(40, 0, 40, W, H)).toEqual({ x: 1, y: 0 });
    expect(swipeOutcome(0, 40, 40, W, H)).toEqual({ x: 0, y: 1 });
  });
  it('a small or slow nudge, a tap, and an upward drag leave it in place', () => {
    expect(swipeOutcome(30, 5, 800, W, H)).toBeNull();
    expect(swipeOutcome(0, 0, 80, W, H)).toBeNull();
    expect(swipeOutcome(0, -200, 100, W, H)).toBeNull();
    expect(swipeOutcome(10, 10, 10, W, H)).toBeNull();
  });
});
