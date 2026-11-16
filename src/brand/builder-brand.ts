// A builder's own brand on a building (SPEC 18.15): the logo and name where the generic walkthru icon was, and the builder's colour as
// the accent of that building's chrome. The file says what it wants (`brand` in building.json); this module decides what is safe to
// show: a colour that would make text unreadable is not used, and the default terracotta stays. Pure rules first, then two DOM helpers.
import type { BuilderBrand } from '../building/types';

export interface Rgb { r: number; g: number; b: number }
export function parseHex(hex: string): Rgb | null {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export const toHex = (c: Rgb): string => `#${[c.r, c.g, c.b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
/** WCAG relative luminance and contrast ratio. */
export function luminance(c: Rgb): number {
  const f = (v: number): number => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
export function contrast(a: Rgb, b: Rgb): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const mix = (a: Rgb, b: Rgb, t: number): Rgb => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t });

const WHITE: Rgb = { r: 255, g: 255, b: 255 }, BLACK: Rgb = { r: 0, g: 0, b: 0 };
/** the glass panel at its solid value (tokens.css --wt-glass-solid over a dark scene) and the paper of the pages */
export const GLASS: Rgb = { r: 26, g: 21, b: 19 }, PAPER: Rgb = { r: 247, g: 240, b: 228 };
export const AA = 4.5;

export interface BrandAccent {
  /** the fill under white text (buttons) and the accent on paper */
  accent: string;
  /** the same, pressed or hovered */
  accentDark: string;
  /** the accent as a line or a word on the dark glass panels: the same hue, lifted until it reads */
  onGlass: string;
  /** a pale tint of it, for a selected row on paper */
  soft: string;
}

/**
 * The accent a builder's colour gives, or null when it cannot be used. The colour is the fill of the primary buttons, so white text on
 * it must reach AA (4.5), and it is an accent on the paper pages, so it must reach 3 against the paper. On the glass panels the colour
 * is lifted towards white, in steps, until it reaches AA against the panel; a colour that cannot get there is refused. Anything
 * refused falls back to the default terracotta: a wrong colour never makes a word unreadable.
 */
export function brandAccent(hex: string | undefined): BrandAccent | null {
  const c = hex ? parseHex(hex) : null;
  if (!c) return null;
  if (contrast(WHITE, c) < AA || contrast(c, PAPER) < 3) return null;
  let on: Rgb | null = null;
  for (let t = 0; t <= 0.85; t += 0.05) { const m = mix(c, WHITE, t); if (contrast(m, GLASS) >= AA) { on = m; break; } }
  if (!on) return null;
  return { accent: toHex(c), accentDark: toHex(mix(c, BLACK, 0.2)), onGlass: toHex(on), soft: toHex(mix(c, WHITE, 0.84)) };
}

/** The custom properties a brand sets on its building's pages, or an empty object when it has no usable colour. */
export function brandVars(brand: BuilderBrand | undefined): Record<string, string> {
  const a = brandAccent(brand?.accent);
  if (!a) return {};
  return { '--wt-clay': a.accent, '--wt-clay-dark': a.accentDark, '--wt-clay-soft': a.soft, '--wt-accent': a.accent, '--wt-accent-dark': a.accentDark, '--wt-accent-on-glass': a.onGlass };
}
const VAR_NAMES = ['--wt-clay', '--wt-clay-dark', '--wt-clay-soft', '--wt-accent', '--wt-accent-dark', '--wt-accent-on-glass'];

/** Where the logo file is, or null when the brand names none. */
export function brandLogoUrl(buildingId: string, brand: BuilderBrand | undefined): string | null {
  return brand?.logo ? `/buildings/${buildingId}/${brand.logo}` : null;
}

/** What the chrome needs to show a brand: resolved once from the building file. */
export interface ShownBrand { name: string; tagline: string | null; logoUrl: string | null; credit: boolean }
export function shownBrand(buildingId: string, brand: BuilderBrand | undefined): ShownBrand | null {
  if (!brand) return null;
  return { name: brand.name, tagline: brand.tagline ?? null, logoUrl: brandLogoUrl(buildingId, brand), credit: brand.hideCredit !== true };
}
export const CREDIT_TEXT = 'powered by walkthru';
/** Two letters for a brand with no logo: "Sample Developers" -> "SD". */
export function brandInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : words[0]?.[1] ?? '')).toUpperCase();
}

// ---------------------------------------------------------------- DOM

/** Sets (or clears) the brand's accent on an element: every piece of chrome inside it takes the colour through the tokens. */
export function applyBrandAccent(el: HTMLElement, brand: BuilderBrand | undefined): void {
  const vars = brandVars(brand);
  for (const name of VAR_NAMES) { if (vars[name]) el.style.setProperty(name, vars[name]); else el.style.removeProperty(name); }
}

/** The logo as a small tile (the image, or the brand's initials when there is no file or it fails to load). */
export function brandMarkEl(doc: Document, b: ShownBrand, cls: string): HTMLElement {
  const box = doc.createElement('span');
  box.className = cls;
  const initials = (): void => { box.textContent = brandInitials(b.name); box.classList.add('is-initials'); };
  if (b.logoUrl) {
    const img = doc.createElement('img');
    img.src = b.logoUrl;
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => { img.remove(); initials(); });
    box.appendChild(img);
  } else initials();
  return box;
}
