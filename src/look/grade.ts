// Owned by C11a (look-light). SPEC 16.5 "Time of day, grade and interior lights". Pure: no three, no DOM.
// One table of keyframes (hour -> light colour, sky, exposure, grade) and a smooth blend between them. The four presets are
// just four hours. Everything here is a mood, never a fact about the property: sizes and geometry are untouched.
import { HOUR_MAX, HOUR_MIN } from './types';

export type LookPreset = 'morning' | 'afternoon' | 'evening' | 'night';
export const LOOK_PRESETS: LookPreset[] = ['morning', 'afternoon', 'evening', 'night'];
export const PRESET_LABEL: Record<LookPreset, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
/** the hour each preset stands for (the slider moves between them) */
export const PRESET_HOURS: Record<LookPreset, number> = { morning: 8.5, afternoon: 15, evening: 17.8, night: 20.5 };
/** what a buyer sees first: warm and bright enough to read the rooms, with a long soft sun patch */
export const DEFAULT_PRESET: LookPreset = 'afternoon';
/** the sun is below the horizon from here on (the night preset): no sun light, no sun shadow */
export const SUN_SET_HOUR = 19.1;

export type Rgb = [number, number, number];

/** one moment of the day; colours are sRGB hex, everything else a plain number */
interface Key {
  hour: number;
  sun: string; sunI: number;
  hemiSky: string; hemiGround: string; hemiI: number;
  /** envIntensity multiplier for the image-based light */ env: number;
  exposure: number;
  zenith: string; mid: string; horizon: string; ground: string; glow: string; glowI: number;
  /** post (high tier): white balance multiplier, saturation, contrast, shadow and highlight tint, bloom, vignette */
  wb: string; sat: number; contrast: number; shadowTint: string; highlightTint: string; bloom: number; vignette: number;
  /** how far the interior lights are on, 0..1 (tube lights, cove lights) */
  tube: number; cove: number;
}

const KEYS: Key[] = [
  { hour: 6, sun: '#FFBE86', sunI: 2.4, hemiSky: '#A5B6D2', hemiGround: '#B9A08A', hemiI: 0.95, env: 0.8, exposure: 1.2,
    zenith: '#5A82B6', mid: '#B4B8CA', horizon: '#F8C9A2', ground: '#C4A68E', glow: '#FFB87C', glowI: 1.0,
    wb: '#FFF4E8', sat: 1.04, contrast: 1.04, shadowTint: '#EAF0FF', highlightTint: '#FFEBD6', bloom: 0.3, vignette: 0.26, tube: 0, cove: 0 },
  { hour: 8.5, sun: '#FFEBCC', sunI: 4.6, hemiSky: '#C9DAEF', hemiGround: '#D2BEA2', hemiI: 1.1, env: 1, exposure: 1.15,
    zenith: '#5F96D4', mid: '#9CC4E8', horizon: '#F1E6D2', ground: '#D4C8B2', glow: '#FFE6BE', glowI: 0.8,
    wb: '#FFF7EC', sat: 1.04, contrast: 1.05, shadowTint: '#E8F1FF', highlightTint: '#FFF1DC', bloom: 0.3, vignette: 0.22, tube: 0, cove: 0 },
  { hour: 15, sun: '#FFE8C6', sunI: 5.9, hemiSky: '#D6E2F0', hemiGround: '#CDB89C', hemiI: 0.98, env: 1, exposure: 1.1,
    zenith: '#4F8CCE', mid: '#A9C9E6', horizon: '#ECE6D8', ground: '#D6C8AA', glow: '#FFDDA6', glowI: 0.9,
    wb: '#FFF7EC', sat: 1.08, contrast: 1.09, shadowTint: '#E2ECFF', highlightTint: '#FFF0D8', bloom: 0.3, vignette: 0.24, tube: 0, cove: 0 },
  { hour: 17.8, sun: '#FFB674', sunI: 5.4, hemiSky: '#A8B9D8', hemiGround: '#BE9C78', hemiI: 0.95, env: 0.9, exposure: 1.15,
    zenith: '#4A74AC', mid: '#CDA98C', horizon: '#F6BC78', ground: '#B8906A', glow: '#FFAE66', glowI: 1.4,
    wb: '#FFF2E0', sat: 1.04, contrast: 1.08, shadowTint: '#DCE6FF', highlightTint: '#FFE0B8', bloom: 0.4, vignette: 0.32, tube: 0.25, cove: 0.5 },
  { hour: 19.1, sun: '#FF8A4A', sunI: 0, hemiSky: '#5E70A0', hemiGround: '#5E4C48', hemiI: 0.7, env: 0.4, exposure: 1.25,
    zenith: '#243862', mid: '#625C84', horizon: '#D88C6C', ground: '#5E4A46', glow: '#FF8A55', glowI: 0.9,
    wb: '#FFEFE0', sat: 1.04, contrast: 1.08, shadowTint: '#D8E0FF', highlightTint: '#FFD8A8', bloom: 0.45, vignette: 0.4, tube: 0.75, cove: 0.9 },
  { hour: 20.5, sun: '#8FA6D8', sunI: 0, hemiSky: '#4A5C92', hemiGround: '#352E3C', hemiI: 0.3, env: 0.15, exposure: 1.05,
    zenith: '#18233F', mid: '#222E55', horizon: '#34426A', ground: '#242B47', glow: '#34447A', glowI: 0.16,
    wb: '#FFF3E6', sat: 1.04, contrast: 1.08, shadowTint: '#D0DCFF', highlightTint: '#FFDDB0', bloom: 0.5, vignette: 0.44, tube: 1, cove: 1 },
  { hour: HOUR_MAX, sun: '#8FA6D8', sunI: 0, hemiSky: '#4A5C92', hemiGround: '#352E3C', hemiI: 0.3, env: 0.15, exposure: 1.05,
    zenith: '#18233F', mid: '#222E55', horizon: '#34426A', ground: '#242B47', glow: '#34447A', glowI: 0.16,
    wb: '#FFF3E6', sat: 1.04, contrast: 1.08, shadowTint: '#D0DCFF', highlightTint: '#FFDDB0', bloom: 0.5, vignette: 0.44, tube: 1, cove: 1 },
];

export function hexToLinear(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  const lin = (v: number): number => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return [lin(((n >> 16) & 255) / 255), lin(((n >> 8) & 255) / 255), lin((n & 255) / 255)];
}
export function linearToHex(c: Rgb): string {
  const enc = (v: number): number => {
    const x = Math.min(1, Math.max(0, v));
    return Math.round(255 * (x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055));
  };
  return `#${[0, 1, 2].map((i) => enc(c[i]).toString(16).padStart(2, '0')).join('')}`;
}

/** What the look applies for one hour. Colours are linear RGB (three's working space). */
export interface Grade {
  hour: number;
  /** sun light colour and three-unit intensity before the tier scale (0 after sunset) */
  sunColour: Rgb; sunIntensity: number;
  hemiSky: Rgb; hemiGround: Rgb; hemiIntensity: number;
  envScale: number;
  exposure: number;
  /** the sky the window shows: plain gradient, no buildings */
  sky: { zenith: Rgb; mid: Rgb; horizon: Rgb; ground: Rgb; glow: Rgb; glowIntensity: number };
  post: { whiteBalance: Rgb; saturation: number; contrast: number; shadowTint: Rgb; highlightTint: Rgb; bloom: number };
  vignette: number;
  interior: { tube: number; cove: number };
  /** true once the sun is below the horizon */ night: boolean;
}

const COLOUR_FIELDS = ['sun', 'hemiSky', 'hemiGround', 'zenith', 'mid', 'horizon', 'ground', 'glow', 'wb', 'shadowTint', 'highlightTint'] as const;
const NUM_FIELDS = ['sunI', 'hemiI', 'env', 'exposure', 'glowI', 'sat', 'contrast', 'bloom', 'vignette', 'tube', 'cove'] as const;
type Mixed = { [K in (typeof COLOUR_FIELDS)[number]]: Rgb } & { [K in (typeof NUM_FIELDS)[number]]: number };

const smooth = (t: number): number => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

const LIN: Mixed[] = KEYS.map((k) => {
  const o: Record<string, Rgb | number> = {};
  for (const f of COLOUR_FIELDS) o[f] = hexToLinear(k[f]);
  for (const f of NUM_FIELDS) o[f] = k[f];
  return o as Mixed;
});

export function clampDayHour(h: number): number { return Math.min(HOUR_MAX, Math.max(HOUR_MIN, Number.isFinite(h) ? h : PRESET_HOURS[DEFAULT_PRESET])); }

export function gradeAt(hourIn: number): Grade {
  const hour = clampDayHour(hourIn);
  let i = 0;
  while (i < KEYS.length - 2 && hour > KEYS[i + 1].hour) i++;
  const a = LIN[i], b = LIN[i + 1];
  const span = KEYS[i + 1].hour - KEYS[i].hour;
  const t = span > 0 ? smooth(Math.min(1, Math.max(0, (hour - KEYS[i].hour) / span))) : 0;
  const c = (f: (typeof COLOUR_FIELDS)[number]): Rgb => mix(a[f], b[f], t);
  const n = (f: (typeof NUM_FIELDS)[number]): number => lerp(a[f], b[f], t);
  return {
    hour,
    sunColour: c('sun'), sunIntensity: n('sunI'),
    hemiSky: c('hemiSky'), hemiGround: c('hemiGround'), hemiIntensity: n('hemiI'),
    envScale: n('env'),
    exposure: n('exposure'),
    sky: { zenith: c('zenith'), mid: c('mid'), horizon: c('horizon'), ground: c('ground'), glow: c('glow'), glowIntensity: n('glowI') },
    post: { whiteBalance: c('wb'), saturation: n('sat'), contrast: n('contrast'), shadowTint: c('shadowTint'), highlightTint: c('highlightTint'), bloom: n('bloom') },
    vignette: n('vignette'),
    interior: { tube: n('tube'), cove: n('cove') },
    night: hour >= SUN_SET_HOUR,
  };
}

/** The neutral grade of "True colours": white light, no sky colour cast, nothing graded. */
export const TRUE_GRADE: Grade = {
  hour: 12.5,
  sunColour: [1, 1, 1], sunIntensity: 0,
  hemiSky: [1, 1, 1], hemiGround: [1, 1, 1], hemiIntensity: Math.PI,
  envScale: 0,
  exposure: 1,
  sky: { zenith: hexToLinear('#8DB4DC'), mid: hexToLinear('#B6D0EA'), horizon: hexToLinear('#E4ECF4'), ground: hexToLinear('#D8DDE2'), glow: [1, 1, 1], glowIntensity: 0 },
  post: { whiteBalance: [1, 1, 1], saturation: 1, contrast: 1, shadowTint: [1, 1, 1], highlightTint: [1, 1, 1], bloom: 0 },
  vignette: 0,
  interior: { tube: 0, cove: 0 },
  night: false,
};

/** the preset whose hour is closest, or null when the slider sits between two of them */
export function presetOfHour(hour: number): LookPreset | null {
  for (const p of LOOK_PRESETS) if (Math.abs(PRESET_HOURS[p] - hour) < 0.13) return p;
  return null;
}

export function parsePreset(v: unknown): LookPreset | null {
  return typeof v === 'string' && (LOOK_PRESETS as string[]).includes(v) ? (v as LookPreset) : null;
}

/** "Morning", "Late afternoon", "Evening", "Night" for any hour, for the slider's caption */
export function dayPartLabel(hour: number): string {
  const p = presetOfHour(hour);
  if (p) return PRESET_LABEL[p];
  if (hour < 7.5) return 'Early morning';
  if (hour < 12) return 'Morning';
  if (hour < 16.5) return 'Afternoon';
  if (hour < SUN_SET_HOUR) return 'Evening';
  return 'Night';
}

/** The kinds of interior light a fixture can declare (scene-graph convention `userData.walkthruLight`, SPEC 16.5). */
export type InteriorLightKind = 'tube' | 'cove' | 'fan' | 'lamp';
/** 0..1: how much of its full output a fixture of this kind gives at this hour. A 'lamp' and a 'fan' light follow the tube lights. */
export function interiorLevel(kind: InteriorLightKind, g: Grade): number {
  return kind === 'cove' ? g.interior.cove : g.interior.tube;
}
