// Calm by default, reveal on intent (SPEC 2.7): the rules of src/buyer/chrome.ts, and what the identity pill and card say (src/buyer/identity.ts).
import { describe, expect, it } from 'vitest';
import { REVEAL, createChromeMachine, edgeZones, isRevealKey, nextChromeLevel, parseChromeLevel } from '../src/buyer/chrome';
import { areaIn, identityLines, loadUnits, pillText } from '../src/buyer/identity';

const on = (f: Record<string, boolean>): string => Object.keys(f).filter((k) => f[k]).sort().join(' ');

describe('the resting state', () => {
  it('shows the identity pill and nothing else', () => {
    const m = createChromeMachine();
    expect(on(m.flags(0) as never)).toBe('pill');
  });
});

describe('edge zones (a pointer device)', () => {
  const W = 1440, H = 900, U = 1.1;
  it('the top edge, the bottom edge and the bottom left corner; the middle is none of them', () => {
    expect(edgeZones(700, 10, W, H, U)).toEqual(['top']);
    expect(edgeZones(700, 60, W, H, U)).toEqual(['top']);
    expect(edgeZones(700, 450, W, H, U)).toEqual([]);
    expect(edgeZones(700, 880, W, H, U)).toEqual(['bottom']);
    expect(edgeZones(120, 700, W, H, U)).toEqual(['map']);
    expect(edgeZones(120, 880, W, H, U)).toEqual(['bottom', 'map']);
    expect(edgeZones(1300, 700, W, H, U)).toEqual([]);
    expect(edgeZones(-5, 10, W, H, U)).toEqual([]);
  });
  it('scales with the screen and never takes more than a fifth of a short window', () => {
    expect(edgeZones(100, 200, 3840, 2160, 2.65)).toEqual(['top']);
    expect(edgeZones(100, 100, 800, 300, 1)).toEqual([]);
    expect(edgeZones(400, 60, 800, 300, 1)).toEqual(['top']);
  });
  it('the top edge brings in the top row and the view switch; leaving starts a grace, then it goes', () => {
    const m = createChromeMachine();
    m.pointer(['top'], 1000);
    expect(on(m.flags(1000) as never)).toBe('pill top views');
    m.pointer([], 2000);
    expect(m.flags(2000 + REVEAL.graceMs - 1).top).toBe(true);
    expect(m.nextChange(2000)).toBe(2000 + REVEAL.graceMs);
    expect(m.flags(2000 + REVEAL.graceMs).top).toBe(false);
    expect(m.nextChange(2000 + REVEAL.graceMs)).toBeNull();
  });
  it('coming back within the grace keeps it', () => {
    const m = createChromeMachine();
    m.pointer(['top'], 0); m.pointer([], 100); m.pointer(['top'], 400);
    expect(m.flags(5000).top).toBe(true);
  });
  it('each edge has its own part: bottom is the room strip, the corner is the floor plan, the pill is the identity card', () => {
    const m = createChromeMachine();
    m.pointer(['bottom'], 0);
    expect(on(m.flags(0) as never)).toBe('bottom pill');
    m.pointer(['map'], 10);
    expect(m.flags(10).map).toBe(true);
    m.pointer(['id', 'top'], 5000);
    expect(on(m.flags(5000 + REVEAL.graceMs) as never)).toBe('id pill top views');
  });
  it('a panel stays while it is hovered (the pointer is over it, outside the edge) and while it has keyboard focus', () => {
    const m = createChromeMachine();
    m.pointer(['top'], 0);
    m.pointer(['top'], 9000); // still over the bar: the page passes the panel's zone
    expect(m.flags(9000).top).toBe(true);
    m.pointer([], 9100);
    m.focus('top', 9200);
    expect(m.flags(60000).top).toBe(true);
    m.focus(null, 60000);
    expect(m.flags(60000 + REVEAL.graceMs - 1).top).toBe(true);
    expect(m.flags(60000 + REVEAL.graceMs).top).toBe(false);
  });
  it('focus alone reveals a part (everything stays in the tab order)', () => {
    const m = createChromeMachine();
    m.focus('bottom', 0);
    expect(m.flags(0).bottom).toBe(true);
    m.focus('map', 10);
    expect(m.flags(10).map).toBe(true);
  });
});

describe('keys', () => {
  it('Tab and a shortcut reveal; walking, looking and acting keys do not', () => {
    for (const k of ['Tab', 'v', 'V', 'm', 't', 'f', '1']) expect(isRevealKey(k), k).toBe(true);
    for (const k of ['w', 'A', 's', 'd', 'e', ' ', 'ArrowUp', 'ArrowLeft', 'Shift', 'Escape', 'Enter']) expect(isRevealKey(k), k).toBe(false);
    expect(isRevealKey('c', { meta: true })).toBe(false);
  });
  it('a key shows everything for a few seconds', () => {
    const m = createChromeMachine();
    m.key(100);
    expect(on(m.flags(100) as never)).toBe('bottom map pill top views');
    expect(m.flags(100 + REVEAL.keyMs - 1).top).toBe(true);
    expect(m.flags(100 + REVEAL.keyMs).top).toBe(false);
    expect(m.nextChange(100)).toBe(100 + REVEAL.keyMs);
  });
});

describe('touch', () => {
  it('has no edges: a tap on the empty scene brings everything in, another sends it away', () => {
    const m = createChromeMachine({ touch: true });
    expect(on(m.flags(0) as never)).toBe('handle pill');
    m.tap(1000);
    expect(on(m.flags(1000) as never)).toBe('bottom map pill top views');
    m.tap(2000);
    expect(on(m.flags(2000) as never)).toBe('handle pill');
  });
  it('fades about five seconds after the last touch; a touch on the chrome keeps it', () => {
    const m = createChromeMachine({ touch: true });
    m.tap(0);
    expect(m.flags(REVEAL.touchMs - 1).top).toBe(true);
    expect(m.flags(REVEAL.touchMs).top).toBe(false);
    m.tap(10000); m.touched(13000);
    expect(m.flags(13000 + REVEAL.touchMs - 1).top).toBe(true);
    expect(m.flags(13000 + REVEAL.touchMs).top).toBe(false);
  });
  it('the handle is always there as the way in, and opens the chrome', () => {
    const m = createChromeMachine({ touch: true });
    expect(m.flags(0).handle).toBe(true);
    m.handle(100);
    expect(m.flags(200).top).toBe(true);
    expect(m.flags(200).handle).toBe(false);
    expect(m.flags(100 + REVEAL.touchMs).handle).toBe(true);
  });
  it('a tap does nothing on a mouse', () => {
    const m = createChromeMachine();
    m.tap(0);
    expect(m.flags(1).top).toBe(false);
  });
});

describe('the first visit', () => {
  it('shows the chrome fully for about four seconds, then settles', () => {
    const m = createChromeMachine();
    m.begin(1000, true);
    expect(on(m.flags(1000) as never)).toBe('bottom map pill top views');
    expect(m.flags(1000 + REVEAL.firstRunMs - 1).bottom).toBe(true);
    expect(on(m.flags(1000 + REVEAL.firstRunMs) as never)).toBe('pill');
  });
  it('a returning viewer starts calm', () => {
    const m = createChromeMachine();
    m.begin(1000, false);
    expect(on(m.flags(1000) as never)).toBe('pill');
  });
});

describe('the three levels', () => {
  it('always: everything pinned (the identity card still opens on intent)', () => {
    const m = createChromeMachine({ level: 'always' });
    expect(on(m.flags(0) as never)).toBe('bottom map pill top views');
    expect(on(m.flags(1e9) as never)).toBe('bottom map pill top views');
  });
  it('hidden: nothing but the handle; edges bring nothing in; the handle, Tab and focus do', () => {
    const m = createChromeMachine({ level: 'hidden' });
    expect(on(m.flags(0) as never)).toBe('handle');
    m.pointer(['top', 'bottom', 'map'], 10);
    expect(on(m.flags(10) as never)).toBe('handle');
    m.handle(100);
    expect(on(m.flags(100) as never)).toBe('bottom map pill top views');
    m.pointer(['top'], 200); // now that it is in, the pointer on it holds it
    expect(m.flags(100 + REVEAL.touchMs + 5000).top).toBe(true);
    m.pointer([], 20000);
    expect(on(m.flags(20000 + REVEAL.graceMs) as never)).toBe('handle');
    m.focus('top', 30000);
    expect(m.flags(30000).top).toBe(true);
  });
  it('the first visit does not open a hidden chrome', () => {
    const m = createChromeMachine({ level: 'hidden' });
    m.begin(0, true);
    expect(on(m.flags(1) as never)).toBe('handle');
  });
  it('the one button steps auto, always, hidden and back', () => {
    expect(nextChromeLevel('auto')).toBe('always');
    expect(nextChromeLevel('always')).toBe('hidden');
    expect(nextChromeLevel('hidden')).toBe('auto');
    const m = createChromeMachine();
    m.setLevel('always', 0);
    expect(m.flags(0).bottom).toBe(true);
    m.setLevel('hidden', 10);
    expect(m.flags(20).bottom).toBe(false);
    expect(m.flags(5000).top).toBe(false);
  });
  it('by URL: chrome= wins, kiosk is hidden, autohide=0 is always, autohide=<s> is auto with that linger', () => {
    expect(parseChromeLevel('')).toEqual({ level: 'auto', lingerMs: null });
    expect(parseChromeLevel('?chrome=always').level).toBe('always');
    expect(parseChromeLevel('?chrome=hidden').level).toBe('hidden');
    expect(parseChromeLevel('?kiosk=1').level).toBe('hidden');
    expect(parseChromeLevel('?kiosk=1&chrome=auto').level).toBe('auto');
    expect(parseChromeLevel('?autohide=0')).toEqual({ level: 'always', lingerMs: null });
    expect(parseChromeLevel('?autohide=12')).toEqual({ level: 'auto', lingerMs: 12000 });
    expect(parseChromeLevel('?autohide=x&chrome=nope')).toEqual({ level: 'auto', lingerMs: null });
    const m = createChromeMachine({ lingerMs: 12000 });
    m.key(0);
    expect(m.flags(11999).top).toBe(true);
    expect(m.flags(12000).top).toBe(false);
  });
});

describe('mode exceptions', () => {
  it('while the tour plays only its card shows (and the pill), whatever the pointer does and at every level', () => {
    for (const level of ['auto', 'always'] as const) {
      const m = createChromeMachine({ level });
      m.setContext({ touring: true });
      m.pointer(['top', 'bottom', 'map'], 0);
      m.key(0);
      expect(on(m.flags(1) as never), level).toBe('pill');
    }
    const k = createChromeMachine({ level: 'hidden' });
    k.setContext({ touring: true });
    expect(on(k.flags(0) as never)).toBe('handle');
  });
  it('Furnish and Measure keep their tools', () => {
    const m = createChromeMachine();
    m.setContext({ mode: 'furnish' });
    expect(on(m.flags(0) as never)).toBe('pill top views');
    m.setContext({ mode: 'measure' });
    expect(m.flags(0).top).toBe(true);
    m.setContext({ mode: 'walk' });
    expect(m.flags(0).top).toBe(false);
  });
  it('the doll house and the plan keep the view switch; the rest follows the rule', () => {
    const m = createChromeMachine();
    m.setContext({ view: 'doll' });
    expect(on(m.flags(0) as never)).toBe('pill views');
    m.setContext({ view: 'plan' });
    expect(on(m.flags(0) as never)).toBe('pill views');
    m.pointer(['top'], 10);
    expect(on(m.flags(10) as never)).toBe('pill top views');
  });
  it('a sheet opened from the top row keeps the row', () => {
    const m = createChromeMachine();
    m.setContext({ sheet: true });
    expect(m.flags(0).top).toBe(true);
    m.setContext({ sheet: false });
    expect(m.flags(0).top).toBe(false);
  });
});

describe('what the identity says', () => {
  it('the pill is one line: the place and what it is, never the area or the level', () => {
    expect(pillText('Flat 204 · 3 BHK · 1,117 sq ft')).toBe('Flat 204 · 3 BHK');
    expect(pillText('Entrance lobby')).toBe('Entrance lobby');
    expect(pillText('Pool area')).toBe('Pool area');
    expect(pillText('A · B · C · D')).toBe('A · B');
  });
  it('the card: the place with its area, then the level and the room, one unit at a time', () => {
    expect(identityLines('Flat 204 · 3 BHK · 1,117 sq ft', 'Level 2', 'Living · 228 sq ft · 21.1 m²', 'sqft')).toEqual({
      pill: 'Flat 204 · 3 BHK', place: 'Flat 204 · 3 BHK · 1,117 sq ft', where: 'Level 2 · Living 228 sq ft', warn: null,
    });
    const m = identityLines('Flat 204 · 3 BHK · 1,117 sq ft', 'Level 2', 'Living · 228 sq ft · 21.1 m²', 'm2');
    expect(m.place).toBe('Flat 204 · 3 BHK · 103.8 m²');
    expect(m.where).toBe('Level 2 · Living 21.1 m²');
    expect(identityLines('Sample home', null, null, 'sqft').where).toBeNull();
    expect(identityLines('Sample home', null, 'Kitchen · 80 sq ft · 7.4 m²', 'sqft').where).toBe('Kitchen 80 sq ft');
  });
  it('a size that is not measured or a guessed shape is never turned into a number, and is raised as a warning', () => {
    const a = identityLines('Home', null, 'Store · not measured (no dimension on the drawing)', 'sqft');
    expect(a.where).toBe('Store · not measured (no dimension on the drawing)');
    expect(a.warn).toBe('Store: not measured (no dimension on the drawing)');
    expect(identityLines('Home', 'Level 1', 'Terrace · shape guessed', 'm2').warn).toBe('Terrace: shape guessed');
  });
  it('areas in one unit', () => {
    expect(areaIn('215 sq ft · 20.0 m²', 'sqft')).toBe('215 sq ft');
    expect(areaIn('215 sq ft · 20.0 m²', 'm2')).toBe('20.0 m²');
    expect(areaIn('Not measured', 'm2')).toBe('Not measured');
    expect(areaIn('2 BHK · 644 sq ft', 'm2')).toBe('2 BHK · 59.8 m²');
    expect(areaIn('Hall · 103.8 m²', 'sqft')).toBe('Hall · 1,117 sq ft');
  });
  it('the unit follows the link, then the saved choice, then square feet', () => {
    expect(loadUnits('', () => null)).toBe('sqft');
    expect(loadUnits('', () => 'm2')).toBe('m2');
    expect(loadUnits('?units=sqft', () => 'm2')).toBe('sqft');
    expect(loadUnits('?units=m2', () => null)).toBe('m2');
    expect(loadUnits('?units=furlongs', () => { throw new Error('blocked'); })).toBe('sqft');
  });
});
