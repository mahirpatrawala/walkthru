// Owned by C11b. SPEC 16.6.3: skin tones and the colours of the family's clothes. Turns the glTF materials of a person
// body into the walkthru look. Nothing here loads files: the meshes are already parsed.
//
// The family bodies carry no textures. Every part is a flat colour chosen by its role (the mesh name that
// tools/make_family.py gives it): skin (the buyer's tone), eyes, brows, hair and shoes, and four garment roles. `top` is
// the kurta, kameez, blouse or shirt and takes the height preset's tint (16 % desaturated so it reads as dyed cotton);
// `bottom` is the pyjama, salwar or saree skirt; `wrap` is the dupatta or the pallu; `trim` is the neckline and hem border.
import * as THREE from 'three';

/** sRGB targets for the mean skin colour: fair, wheatish, medium brown (default), brown, deep brown. */
export const SKIN_TONES = ['#E3B998', '#CF9F7B', '#B07F5C', '#8E5F41', '#6B4631'] as const;
export const SKIN_TONE_NAMES = ['Fair', 'Wheatish', 'Medium brown', 'Brown', 'Deep brown'] as const;
export const DEFAULT_TONE = 2;
export const FABRIC_DESATURATE = 0.16;
/**
 * Calibration: under "True colours" (neutral light, exposure 1) the skin shows about 6 % brighter than its albedo because of the
 * sheen at roughness 0.6 and the ambient term. The light sheen lifts the blue channel most, so the gain is per channel; measured on screen against the five targets (browser check 11).
 */
export const SKIN_ALBEDO_GAIN = [0.95, 0.91, 0.86] as const;

type Body = 'man' | 'woman' | 'elder' | 'child';

/** The fixed colours of each person. The top's colour comes from the height preset (`setTop`). */
export const OUTFITS: Record<Body, { bottom: string; wrap: string; trim: string; hair: string; brows: string; shoes: string; eyes: string; pupil: string }> = {
  man: { bottom: '#E8E0CC', wrap: '#E8E0CC', trim: '#C9A24A', hair: '#1D1815', brows: '#1A1512', shoes: '#4B3A2E', eyes: '#F3F0EA', pupil: '#1B1311' },
  woman: { bottom: '#D9CDB6', wrap: '#9A2E4C', trim: '#C9A24A', hair: '#1A1513', brows: '#1A1512', shoes: '#5A4232', eyes: '#F3F0EA', pupil: '#1B1311' },
  elder: { bottom: '#A4453C', wrap: '#A4453C', trim: '#D2AE5C', hair: '#D9D5CD', brows: '#B9B4AB', shoes: '#4B3A2E', eyes: '#F3F0EA', pupil: '#1B1311' },
  child: { bottom: '#E3DAC4', wrap: '#E3DAC4', trim: '#C9A24A', hair: '#1D1815', brows: '#1A1512', shoes: '#C0563A', eyes: '#F3F0EA', pupil: '#1B1311' },
};

/** The albedo to paint for a tone: the target colour times the calibration gain. */
export function skinTone(i: number): THREE.Color {
  const hex = SKIN_TONES[clampTone(i)];
  const ch = (k: number): number => parseInt(hex.slice(1 + 2 * k, 3 + 2 * k), 16) / 255;
  // the gain is applied to the sRGB value, the unit the targets and the on-screen measurements are in
  return new THREE.Color().setRGB(ch(0) * SKIN_ALBEDO_GAIN[0], ch(1) * SKIN_ALBEDO_GAIN[1], ch(2) * SKIN_ALBEDO_GAIN[2], THREE.SRGBColorSpace);
}

export function clampTone(t: unknown): number {
  const n = typeof t === 'number' && Number.isFinite(t) ? Math.round(t) : DEFAULT_TONE;
  return Math.min(SKIN_TONES.length - 1, Math.max(0, n));
}

/** A tint 16 % desaturated so it reads as dyed fabric rather than a toy colour. */
export function fabricColour(hex: string): THREE.Color {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return c.setHSL(hsl.h, hsl.s * (1 - FABRIC_DESATURATE), hsl.l);
}

export interface PersonLook {
  setTone(i: number): void;
  readonly tone: number;
  /** the colour of the top (the height preset's tint); desaturated here */
  setTop(hex: string): void;
  materials: THREE.MeshStandardMaterial[];
}

const ROUGHNESS: Record<string, number> = { skin: 0.62, eyes: 0.25, pupil: 0.12, brows: 0.8, hair: 0.62, shoes: 0.7, top: 0.9, bottom: 0.9, wrap: 0.9, trim: 0.7 };

/**
 * Prepares the materials of a freshly parsed person. Every skinned mesh gets its own material (tint and tone never leak
 * between characters). Call once per parsed GLB.
 */
export function stylePerson(skinned: THREE.SkinnedMesh[], body: Body, tone: number): PersonLook {
  const mats: THREE.MeshStandardMaterial[] = [];
  const skinMats: THREE.MeshStandardMaterial[] = [];
  const topMats: THREE.MeshStandardMaterial[] = [];
  let toneIdx = clampTone(tone);
  const o = OUTFITS[body];
  const fixed: Record<string, string> = { bottom: o.bottom, wrap: o.wrap, trim: o.trim, hair: o.hair, brows: o.brows, shoes: o.shoes, eyes: o.eyes, pupil: o.pupil };
  for (const s of skinned) {
    const mat = (s.material as THREE.MeshStandardMaterial).clone();
    s.material = mat;
    mats.push(mat);
    mat.map = null;
    mat.normalMap = null;
    mat.metalness = 0;
    mat.roughness = ROUGHNESS[s.name] ?? 0.8;
    if (s.name === 'skin') { mat.color.copy(skinTone(toneIdx)); skinMats.push(mat); }
    else if (s.name === 'top') { mat.color.copy(fabricColour('#E8823A')); topMats.push(mat); }
    else if (fixed[s.name]) mat.color.set(fixed[s.name]);
    s.castShadow = false;
  }
  return {
    get tone() { return toneIdx; },
    setTone(i) {
      toneIdx = clampTone(i);
      for (const m of skinMats) m.color.copy(skinTone(toneIdx));
    },
    setTop(hex) {
      const c = fabricColour(hex);
      for (const m of topMats) m.color.copy(c);
    },
    materials: mats,
  };
}
