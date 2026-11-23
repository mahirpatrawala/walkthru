// A builder's brand on a building (SPEC 18.15): what the file may say, which colours are used and which fall back, and the HUD showing it.
import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { BRAND_LOGO_RE, parseBrand, parseBuilding } from '../src/building/parse';
import { AA, GLASS, PAPER, brandAccent, brandInitials, brandLogoUrl, brandVars, contrast, parseHex, shownBrand } from '../src/brand/builder-brand';
import { clone, rawBuilding, readBuilding } from './helpers/sample-building';
import { StubEl, installDomStub } from './dom-stub';

const WHITE = { r: 255, g: 255, b: 255 };
const hex = (s: string) => parseHex(s)!;

describe('the brand block of building.json', () => {
  it('reads a whole brand and a name alone', () => {
    expect(parseBrand({ name: ' Sample Developers ', logo: 'brand.svg', accent: '#1f6f5c', tagline: 'A line', hideCredit: true })).toEqual({ name: 'Sample Developers', logo: 'brand.svg', accent: '#1F6F5C', tagline: 'A line', hideCredit: true });
    expect(parseBrand({ name: 'Sample Developers' })).toEqual({ name: 'Sample Developers' });
    expect(parseBrand({ name: 'Sample Developers', hideCredit: false })).toEqual({ name: 'Sample Developers' });
  });
  it('refuses a brand it cannot show, and says where', () => {
    const bad = (v: unknown): string => { try { parseBrand(v); } catch (e) { return (e as Error).message; } return 'accepted'; };
    expect(bad('Sample')).toMatch(/brand/);
    expect(bad({})).toMatch(/brand\.name/);
    expect(bad({ name: 'x'.repeat(61) })).toMatch(/brand\.name/);
    expect(bad({ name: 'A', logo: '../secret.svg' })).toMatch(/brand\.logo/);
    expect(bad({ name: 'A', logo: 'logo.jpg' })).toMatch(/brand\.logo/);
    expect(bad({ name: 'A', logo: 'a/b.png' })).toMatch(/brand\.logo/);
    expect(bad({ name: 'A', accent: 'green' })).toMatch(/brand\.accent/);
    expect(bad({ name: 'A', accent: '#1F6' })).toMatch(/brand\.accent/);
    expect(bad({ name: 'A', tagline: '' })).toMatch(/brand\.tagline/);
    expect(bad({ name: 'A', hideCredit: 'yes' })).toMatch(/brand\.hideCredit/);
    expect(BRAND_LOGO_RE.test('brand.svg')).toBe(true);
  });
  it('the furnished sample carries the demonstration brand, with its logo file; the empty twin carries none', () => {
    const tower = readBuilding('sample-tower');
    expect(tower.brand?.name).toBeTruthy();
    expect(fs.existsSync(path.resolve('public/buildings/sample-tower', tower.brand!.logo!))).toBe(true);
    expect(fs.readFileSync(path.resolve('public/buildings/sample-tower', tower.brand!.logo!), 'utf8')).toMatch(/^<svg /);
    expect(brandAccent(tower.brand!.accent)).not.toBeNull();
    expect(readBuilding('sample-tower-empty').brand).toBeUndefined();
  });
  it('a building with a broken brand does not parse', () => {
    const r = clone(rawBuilding('sample-tower')) as { brand?: unknown };
    r.brand = { name: 'A', accent: 'teal' };
    expect(() => parseBuilding(r)).toThrow(/brand\.accent/);
    delete r.brand;
    expect(parseBuilding(r).brand).toBeUndefined();
  });
});

describe('the accent a brand colour gives', () => {
  it('uses a colour that reads: white on the fill, the lifted tint on the glass', () => {
    for (const c of ['#1F6F5C', '#B2472B', '#1D3F8F', '#6A2C91', '#111111']) {
      const a = brandAccent(c)!;
      expect(a, c).not.toBeNull();
      expect(a.accent).toBe(c);
      expect(contrast(WHITE, hex(a.accent))).toBeGreaterThanOrEqual(AA);
      expect(contrast(WHITE, hex(a.accentDark))).toBeGreaterThan(contrast(WHITE, hex(a.accent)));
      expect(contrast(hex(a.onGlass), GLASS)).toBeGreaterThanOrEqual(AA);
      expect(contrast(hex(a.accent), PAPER)).toBeGreaterThanOrEqual(3);
    }
  });
  it('falls back to the default (sets nothing) for a colour white text cannot sit on, and for nonsense', () => {
    for (const c of ['#FFD400', '#F7F0E4', '#FFFFFF', '#7FD1C7', '#F0906F', 'green', '', undefined]) expect(brandAccent(c), String(c)).toBeNull();
    expect(brandVars({ name: 'A', accent: '#FFD400' })).toEqual({});
    expect(brandVars({ name: 'A' })).toEqual({});
    expect(brandVars(undefined)).toEqual({});
  });
  it('sets the accent tokens, and only those', () => {
    const v = brandVars({ name: 'A', accent: '#1F6F5C' });
    expect(Object.keys(v).sort()).toEqual(['--wt-accent', '--wt-accent-dark', '--wt-accent-on-glass', '--wt-clay', '--wt-clay-dark', '--wt-clay-soft']);
    expect(v['--wt-accent']).toBe('#1F6F5C');
    expect(v['--wt-accent-on-glass']).not.toBe('#1F6F5C'); // the green itself is too dark on the glass: it is lifted
  });
  it('knows where the logo is, what to show, and initials for a brand with no logo', () => {
    expect(brandLogoUrl('sample-tower', { name: 'A', logo: 'brand.svg' })).toBe('/buildings/sample-tower/brand.svg');
    expect(brandLogoUrl('sample-tower', { name: 'A' })).toBeNull();
    expect(shownBrand('b', undefined)).toBeNull();
    expect(shownBrand('b', { name: 'A B', hideCredit: true })).toEqual({ name: 'A B', tagline: null, logoUrl: null, credit: false });
    expect(shownBrand('b', { name: 'A B', tagline: 'T', logo: 'l.png' })).toEqual({ name: 'A B', tagline: 'T', logoUrl: '/buildings/b/l.png', credit: true });
    expect(brandInitials('Sample Developers')).toBe('SD');
    expect(brandInitials('walkers')).toBe('WA');
  });
});

describe('the HUD with a brand', () => {
  beforeAll(() => { installDomStub(); });
  it('shows the logo, the name and the credit, and goes back to the plain card', async () => {
    const { showIdentityBrand } = await import('../src/buyer/hud');
    const mk = (): StubEl => new StubEl('DIV');
    const parts = { card: mk(), icon: mk(), name: mk(), text: mk(), credit: null as StubEl | null };
    const plain = (icon: { textContent: string }): void => { icon.textContent = 'plain icon'; };
    const show = (b: Parameters<typeof showIdentityBrand>[2]): void => showIdentityBrand(document, parts as never, b, plain as never);
    const logo = (): StubEl | undefined => parts.icon.all().find((e) => e.attrs['data-testid'] === 'brand-logo');
    const credit = (): StubEl | undefined => parts.text.all().find((e) => e.attrs['data-testid'] === 'brand-credit');

    show({ name: 'Sample Developers', tagline: null, logoUrl: '/buildings/sample-tower/brand.svg', credit: true });
    expect(parts.name.textContent).toBe('Sample Developers');
    expect((parts.name as unknown as { hidden: boolean }).hidden).toBe(false);
    expect(parts.card.className).toContain('has-brand');
    expect(logo()!.all().some((e) => e.tagName === 'IMG' && (e as unknown as { src: string }).src === '/buildings/sample-tower/brand.svg')).toBe(true);
    expect(credit()!.textContent).toBe('powered by firstbeam');

    // no logo file: the initials; the credit turned off: no credit, and never two
    show({ name: 'Sample Developers', tagline: null, logoUrl: null, credit: false });
    expect(credit()).toBeUndefined();
    expect(logo()!.textContent).toBe('SD');
    show({ name: 'Sample Developers', tagline: null, logoUrl: null, credit: true });
    show({ name: 'Sample Developers', tagline: null, logoUrl: null, credit: true });
    expect(parts.text.all().filter((e) => e.attrs['data-testid'] === 'brand-credit')).toHaveLength(1);

    show(null);
    expect(logo()).toBeUndefined();
    expect(credit()).toBeUndefined();
    expect(parts.icon.textContent).toBe('plain icon');
    expect((parts.name as unknown as { hidden: boolean }).hidden).toBe(true);
    expect(parts.card.className).not.toContain('has-brand');
  });
});
