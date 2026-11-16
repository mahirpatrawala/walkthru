// Owned by C11b. SPEC 16.6.3: skin tones and the colours of the family's clothes. Turns the glTF materials of a person
// body into the walkthru look. Nothing here loads files: the meshes are already parsed.
//
// The family bodies carry no textures. Every part is a flat colour chosen by its role (the mesh name that
// tools/make_family.py gives it): skin (the buyer's tone), eyes, brows, hair and shoes, and four garment roles. `top` is
// the shirt, kurti, T-shirt or blouse and takes the height preset's tint (16 % desaturated so it reads as dyed cotton);
// `bottom` is the trousers, shorts or saree skirt and never takes the tint; `wrap` is the shirt's buttons or the pallu; `trim` is the belt, the neck band or the border.
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

/** The fixed colours of each person. The top's colour comes from the height preset (`setTop`, `TOP_TINTS`).
 * `bottom` is never tinted: man charcoal trousers, woman beige trousers, child denim shorts, elder navy trousers. `trim` is the man's belt, the
 * neck piping of the woman and the elder, the child's crew-neck rib; `wrap` is the man's shirt buttons (and a saree's pallu, if one is ever built again). */
export const OUTFITS: Record<Body, { bottom: string; wrap: string; trim: string; hair: string; brows: string; shoes: string; eyes: string; pupil: string }> = {
  man: { bottom: '#565C68', wrap: '#EFEBE0', trim: '#2B1D15', hair: '#2D2119', brows: '#221A15', shoes: '#4B3A2E', eyes: '#F3F0EA', pupil: '#1B1311' },
  woman: { bottom: '#CBB994', wrap: '#CBB994', trim: '#EDE4CF', hair: '#2B1F19', brows: '#221A15', shoes: '#5A4232', eyes: '#F3F0EA', pupil: '#1B1311' },
  elder: { bottom: '#3E4A6B', wrap: '#3E4A6B', trim: '#E8E0D0', hair: '#D9D5CD', brows: '#B9B4AB', shoes: '#4B3A2E', eyes: '#F3F0EA', pupil: '#1B1311' },
  child: { bottom: '#3F5F8F', wrap: '#3F5F8F', trim: '#F2F0EA', hair: '#3A2A20', brows: '#2A2019', shoes: '#C0563A', eyes: '#F3F0EA', pupil: '#1B1311' },
};

/**
 * The three colours of each person's top, for their three quick heights in order (`tintForPerson`). The middle one is the person's
 * first impression at their default height (man 175 cm, child 120 cm; the woman's and the elder's default is the first), so it is a
 * believable one: a light blue shirt, a muted teal top, a bright green T-shirt, a soft lavender tunic. Every older tint (teal, crimson,
 * violet, `HEIGHT_TINTS`) is still on offer: teal to the man and the child, crimson to the woman and the elder, violet to all four.
 */
export const TOP_TINTS: Record<Body, readonly [string, string, string]> = {
  man: ['#1FA3A3', '#7FA7D8', '#7A5AF0'],
  woman: ['#4FA3A0', '#B71C6C', '#7A5AF0'],
  elder: ['#B2A3D1', '#B71C6C', '#7A5AF0'],
  child: ['#1FA3A3', '#3BAA5C', '#7A5AF0'],
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

const ROUGHNESS: Record<string, number> = { skin: 0.62, eyes: 0.25, pupil: 0.12, brows: 0.8, hair: 0.9, shoes: 0.7, top: 0.9, bottom: 0.9, wrap: 0.9, trim: 0.7 };

/**
 * Prepares the materials of a freshly parsed person. Every skinned mesh gets its own material (tint and tone never leak
 * between characters). Call once per parsed GLB.
 */
/**
 * SPEC 16.20: the hair is a cap with a hard lower edge; a real hairline is irregular and soft at the nape and the sideburns. The lowest few centimetres of the
 * cap (a fraction of its own height, so it follows any body's scale) dissolve into the skin through a stable hash (alpha hash, so no sorting and no blend
 * halo), per strand-sized cell. The crown and the forehead edge, which sit higher, are untouched, so the bald-spot cover (a geometry test) is unchanged.
 */
function softenHairline(m: THREE.MeshPhysicalMaterial): void {
  const u = { uHairY: { value: 0 }, uHairBand: { value: 1 } };
  m.alphaHash = true;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uHairY = u.uHairY;
    shader.uniforms.uHairBand = u.uHairBand;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHairP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHairP;\nuniform float uHairY;\nuniform float uHairBand;')
      .replace('#include <map_fragment>', `#include <map_fragment>
{
  vec3 c = floor(vHairP * (60.0 / max(uHairBand, 1e-4) * 0.02));
  float n = fract(sin(dot(c, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  float k = (vHairP.y - uHairY) / uHairBand;
  diffuseColor.a *= clamp(k * 1.6 + (n - 0.5) * 1.1, 0.0, 1.0);
}`);
  };
  m.customProgramCacheKey = () => 'walkthru-hair-soft-v1';
  m.onBeforeRender = (_r, _s, _c, geometry) => {
    const g = geometry as THREE.BufferGeometry;
    if (!g.boundingBox) g.computeBoundingBox();
    const b = g.boundingBox;
    if (!b) return;
    u.uHairY.value = b.min.y;
    u.uHairBand.value = Math.max(1e-4, (b.max.y - b.min.y) * 0.1);
  };
}

export function stylePerson(skinned: THREE.SkinnedMesh[], body: Body, tone: number): PersonLook {
  const mats: THREE.MeshStandardMaterial[] = [];
  const skinMats: THREE.MeshStandardMaterial[] = [];
  const topMats: THREE.MeshStandardMaterial[] = [];
  let toneIdx = clampTone(tone);
  const o = OUTFITS[body];
  const fixed: Record<string, string> = { bottom: o.bottom, wrap: o.wrap, trim: o.trim, hair: o.hair, brows: o.brows, shoes: o.shoes, eyes: o.eyes, pupil: o.pupil };
  for (const s of skinned) {
    if (s.name === 'hair') {
      // hair is very dark brown, not black, with a soft sheen band that catches a window or a lamp (SPEC 16.20): it read as a hard black cap from behind
      const old = s.material as THREE.MeshStandardMaterial;
      const hm = new THREE.MeshPhysicalMaterial({
        color: fixed.hair, roughness: 0.5, metalness: 0, sheen: 0.9, sheenRoughness: 0.42,
        sheenColor: new THREE.Color(body === 'elder' ? '#FFFFFF' : '#8A6F5C'), side: old.side,
      });
      old.dispose();
      softenHairline(hm);
      s.material = hm;
      mats.push(hm);
      s.castShadow = false;
      continue;
    }
    const mat = (s.material as THREE.MeshStandardMaterial).clone();
    s.material = mat;
    mats.push(mat);
    mat.map = null;
    mat.normalMap = null;
    mat.metalness = 0;
    mat.roughness = ROUGHNESS[s.name] ?? 0.8;
    if (s.name === 'skin') { mat.color.copy(skinTone(toneIdx)); skinMats.push(mat); }
    else if (s.name === 'top') { mat.color.copy(fabricColour(TOP_TINTS[body][1])); topMats.push(mat); }
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
