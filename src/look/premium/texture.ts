// SPEC 16.24: small helpers for the 2K texture sets (mean luminance of a colour map, so a map only modulates around the finish's own colour, 16.2 rule 2).
import type * as THREE from 'three';

/** mean linear luminance of a colour map (a 32 px copy of it); 0.3 when it cannot be read */
export function meanLuminance(t: THREE.Texture): number {
  try {
    const img = t.image as CanvasImageSource & { width: number; height: number };
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d', { willReadFrequently: true });
    if (!g) return 0.3;
    g.drawImage(img, 0, 0, 32, 32);
    const d = g.getImageData(0, 0, 32, 32).data;
    const lin = (v: number): number => { const x = v / 255; return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) sum += 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2]);
    return Math.max(0.02, sum / (d.length / 4));
  } catch { return 0.3; }
}

/** Where the 2K texture sets of the pool deck and the paving live (public/look/tex/premium, SOURCES.txt there): diffuse and normal, a roughness map */
export interface PremiumSet { slug: string; res: '1k' | '2k'; rough: '1k' }
export const PREMIUM_GROUND: Record<string, PremiumSet> = {
  deck: { slug: 'wood_floor_deck', res: '2k', rough: '1k' },
  paving: { slug: 'red_sandstone_pavement', res: '2k', rough: '1k' },
};
export const premiumPaths = (s: PremiumSet): { diff: string; nor: string; rough: string } => ({
  diff: `tex/premium/${s.slug}/${s.slug}_diff_${s.res}.jpg`,
  nor: `tex/premium/${s.slug}/${s.slug}_nor_gl_${s.res}.jpg`,
  rough: `tex/premium/${s.slug}/${s.slug}_rough_${s.rough}.jpg`,
});
