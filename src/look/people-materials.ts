// Owned by C11b. SPEC 16.6.3: skin tones, clothes colours, hair. Turns the glTF materials of a person body into the
// walkthru look. Nothing here loads files: the meshes are already parsed.
//
// Skin: colour = tone * clamp(texel / mean texel, 0.7, 1.3) per channel, so one texture serves all five tones and keeps the face.
// The mean comes from the material's extras (tools/optimise-people.mjs measured it). Clothes: the top takes the height
// preset's tint, 16 % desaturated; trousers, shoes and hair are fixed colours. Hair and shoes keep their texture as detail.
import * as THREE from 'three';

/** sRGB targets for the mean skin colour: fair, wheatish, medium brown (default), brown, deep brown. */
export const SKIN_TONES = ['#E3B998', '#CF9F7B', '#B07F5C', '#8E5F41', '#6B4631'] as const;
export const SKIN_TONE_NAMES = ['Fair', 'Wheatish', 'Medium brown', 'Brown', 'Deep brown'] as const;
export const DEFAULT_TONE = 2;
export const TROUSERS = { male: '#3B4252', female: '#2F3A4A' } as const;
export const SHOES = '#2A2A2A';
export const HAIR = '#1E1A17';
export const FABRIC_DESATURATE = 0.16;
/**
 * Calibration: under "True colours" (neutral light, exposure 1) the skin shows about 6 % brighter than its albedo because of the
 * sheen at roughness 0.55 and the ambient term. The light sheen lifts the blue channel most, so the gain is per channel; measured on screen against the five targets (browser check 11).
 */
export const SKIN_ALBEDO_GAIN = [0.95, 0.91, 0.86] as const;

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

type Body = 'male' | 'female';

interface DetailUniforms {
  tone: { value: THREE.Color };
  mean: { value: THREE.Vector3 };
  clamp: { value: THREE.Vector2 };
}

/** Replaces the map multiply with `tone * clamp(texel / mean)`; alpha still comes from the texture. */
function detailMultiply(mat: THREE.MeshStandardMaterial, tone: THREE.Color, mean: [number, number, number], clamp: [number, number]): DetailUniforms {
  const u: DetailUniforms = {
    tone: { value: tone.clone() },
    mean: { value: new THREE.Vector3(Math.max(1e-3, mean[0]), Math.max(1e-3, mean[1]), Math.max(1e-3, mean[2])) },
    clamp: { value: new THREE.Vector2(clamp[0], clamp[1]) },
  };
  mat.color.set('#ffffff');
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uPTone = u.tone;
    shader.uniforms.uPMean = u.mean;
    shader.uniforms.uPClamp = u.clamp;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uPTone; uniform vec3 uPMean; uniform vec2 uPClamp;')
      .replace('#include <map_fragment>', `
#ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  diffuseColor.rgb = uPTone * clamp( sampledDiffuseColor.rgb / uPMean, uPClamp.x, uPClamp.y );
  diffuseColor.a *= sampledDiffuseColor.a;
#endif`);
  };
  mat.customProgramCacheKey = () => 'walkthru-person-detail';
  mat.needsUpdate = true;
  return u;
}

export interface PersonLook {
  setTone(i: number): void;
  readonly tone: number;
  /** the colour of the top (the height preset's tint); desaturated here */
  setTop(hex: string): void;
  /** low tier: no maps, flat colours */
  materials: THREE.MeshStandardMaterial[];
}

/** Role of each mesh, by the names tools/optimise-people.mjs gives them. */
const FLAT = new Set(['top', 'bottom']);

/**
 * Prepares the materials of a freshly parsed person. Every skinned mesh gets its own material (tint and tone never leak
 * between characters). Call once per parsed GLB.
 */
export function stylePerson(skinned: THREE.SkinnedMesh[], body: Body, tone: number): PersonLook {
  const mats: THREE.MeshStandardMaterial[] = [];
  let skinU: DetailUniforms | null = null;
  const topMats: THREE.MeshStandardMaterial[] = [];
  let toneIdx = clampTone(tone);
  for (const s of skinned) {
    const src = s.material as THREE.MeshStandardMaterial;
    const mat = src.clone();
    s.material = mat;
    mats.push(mat);
    const mean = (src.userData?.meanLinear as [number, number, number] | undefined) ?? null;
    switch (s.name) {
      case 'skin':
        mat.roughness = 0.55; mat.metalness = 0;
        skinU = detailMultiply(mat, skinTone(toneIdx), mean ?? [0.52, 0.27, 0.17], [0.7, 1.3]);
        break;
      case 'top':
        mat.map = null; mat.color.copy(fabricColour('#E8823A')); mat.roughness = 0.85; mat.metalness = 0;
        topMats.push(mat);
        break;
      case 'bottom':
        mat.map = null; mat.color.set(TROUSERS[body]); mat.roughness = 0.85; mat.metalness = 0;
        break;
      case 'shoes':
        mat.roughness = 0.6; mat.metalness = 0;
        if (mat.map) detailMultiply(mat, new THREE.Color(SHOES), mean ?? [0.09, 0.09, 0.09], [0.5, 1.8]);
        else mat.color.set(SHOES);
        break;
      case 'hair':
        mat.roughness = 0.55; mat.metalness = 0;
        if (mat.map) detailMultiply(mat, new THREE.Color(HAIR), mean ?? [0.02, 0.02, 0.02], [0.5, 2.2]);
        else mat.color.set(HAIR);
        break;
      default:
        // eyes, brows, lashes keep their own texture
        mat.roughness = s.name === 'eyes' ? 0.25 : 0.8; mat.metalness = 0;
    }
    if (FLAT.has(s.name)) mat.normalScale.set(0.8, 0.8);
    s.castShadow = false;
  }
  return {
    get tone() { return toneIdx; },
    setTone(i) {
      toneIdx = clampTone(i);
      skinU?.tone.value.copy(skinTone(toneIdx));
    },
    setTop(hex) {
      const c = fabricColour(hex);
      for (const m of topMats) m.color.copy(c);
    },
    materials: mats,
  };
}
