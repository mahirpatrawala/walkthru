// SPEC 16.24 "2K top quality": what each kind of surface really is. Pure (no three, no DOM): the table of physically based parameters and the rules that
// say which kind a mesh is, from the kit's material key, the part's name and the numbers the material was built with. The layer (layer.ts) applies it.
// Colours are never replaced except for bare metals (a steel body is the colour of steel, not of the pack's tint), so a finish keeps the mean colour it
// was given (16.2 rule 2) and whites stay white: nothing here warms or tints a surface.

export type PbrClass =
  | 'steel' | 'chrome' | 'brass' | 'darkMetal' | 'ceramic' | 'glass' | 'mirror' | 'lacquer' | 'satin' | 'veneer'
  | 'fabric' | 'bedding' | 'leather' | 'plastic' | 'screen' | 'stone' | 'shade';

export interface Pbr {
  /** a bare metal takes this colour (linear sRGB hex) in place of the tint */
  colour?: string;
  metalness: number;
  /** a multiplier of the roughness the material was built with, then clamped to [min, max] */
  rough: { k: number; min: number; max: number };
  clearcoat?: number;
  clearcoatRoughness?: number;
  /** sheen of cloth: a soft rim of light at grazing angles */
  sheen?: number;
  sheenRoughness?: number;
  /** thick glass: transmission, thickness (m) and how much of its tint is kept (0..1) */
  transmission?: number;
  thickness?: number;
  tintKeep?: number;
  /** how strongly the room's reflection shows */
  env: number;
}

export const PBR: Record<PbrClass, Pbr> = {
  steel: { colour: '#D3D7DB', metalness: 1, rough: { k: 0.7, min: 0.2, max: 0.34 }, env: 1 },
  chrome: { colour: '#F3F5F6', metalness: 1, rough: { k: 0.2, min: 0.035, max: 0.08 }, env: 1.1 },
  brass: { metalness: 1, rough: { k: 0.8, min: 0.22, max: 0.34 }, env: 1 },
  darkMetal: { metalness: 0.9, rough: { k: 0.85, min: 0.3, max: 0.42 }, clearcoat: 0.3, clearcoatRoughness: 0.3, env: 0.9 },
  ceramic: { metalness: 0, rough: { k: 0.2, min: 0.05, max: 0.09 }, clearcoat: 1, clearcoatRoughness: 0.03, env: 1 },
  glass: { metalness: 0, rough: { k: 0.05, min: 0.01, max: 0.04 }, transmission: 1, thickness: 0.012, tintKeep: 0.45, env: 1.2 },
  mirror: { colour: '#EEF3F5', metalness: 1, rough: { k: 0.05, min: 0.012, max: 0.03 }, env: 1.25 },
  lacquer: { metalness: 0, rough: { k: 0.55, min: 0.1, max: 0.2 }, clearcoat: 0.9, clearcoatRoughness: 0.07, env: 1 },
  satin: { metalness: 0, rough: { k: 0.9, min: 0.4, max: 0.58 }, clearcoat: 0.28, clearcoatRoughness: 0.34, env: 0.9 },
  veneer: { metalness: 0, rough: { k: 0.8, min: 0.34, max: 0.5 }, clearcoat: 0.32, clearcoatRoughness: 0.26, env: 0.9 },
  fabric: { metalness: 0, rough: { k: 1, min: 0.85, max: 1 }, sheen: 0.4, sheenRoughness: 0.55, env: 0.5 },
  bedding: { metalness: 0, rough: { k: 1, min: 0.8, max: 0.95 }, sheen: 0.5, sheenRoughness: 0.45, env: 0.45 },
  leather: { metalness: 0, rough: { k: 0.8, min: 0.4, max: 0.55 }, clearcoat: 0.3, clearcoatRoughness: 0.33, sheen: 0.25, sheenRoughness: 0.5, env: 0.8 },
  plastic: { metalness: 0, rough: { k: 0.65, min: 0.3, max: 0.5 }, clearcoat: 0.2, clearcoatRoughness: 0.25, env: 0.85 },
  screen: { metalness: 0, rough: { k: 0.1, min: 0.03, max: 0.06 }, clearcoat: 1, clearcoatRoughness: 0.02, env: 1.1 },
  stone: { metalness: 0, rough: { k: 0.55, min: 0.06, max: 0.16 }, clearcoat: 0.65, clearcoatRoughness: 0.06, env: 1 },
  shade: { metalness: 0, rough: { k: 1, min: 0.7, max: 0.95 }, sheen: 0.3, sheenRoughness: 0.6, env: 0.3 },
};

/** what a rule is shown about one material on one mesh */
export interface PbrProbe {
  /** the furniture kit's key (`mat.name`), '' for a material built elsewhere */
  mat: string;
  /** the mesh's name, then its parent's: `wc-pan`, `furniture:wc-1` */
  part: string;
  parent: string;
  rgb: [number, number, number];
  roughness: number;
  metalness: number;
  transparent: boolean;
  vertexColors: boolean;
  emissive: boolean;
  /** built by the lived-in or the design decor (src/look/lived-in), whose materials have no names */
  decor: boolean;
  /** a builder that knows what it made says so (`material.userData.pbr`), and nothing below second-guesses it */
  tag?: PbrClass;
}

const has = (re: RegExp, s: string): boolean => re.test(s);

/** Which class of surface this is, or null to leave the material as it is (paint, floors, foliage, anything the table does not know). */
export function classify(p: PbrProbe): PbrClass | null {
  const part = p.part.toLowerCase(), parent = p.parent.toLowerCase();
  if (p.tag) return p.tag;
  const sat = Math.max(...p.rgb) - Math.min(...p.rgb);
  // ---- by the part's own name (the generators name every part)
  if (has(/screen$|tv-screen/, part)) return 'screen';
  if (has(/mirror/, part)) return 'mirror';
  if (has(/glass|pane|screen-door|shower-door|balustrade/, part) && !has(/frame/, part)) return 'glass';
  if (has(/^(wc|toilet)-(pan|seat|cistern|bowl|lid)|^wc-cistern|basin-(bowl|recess|splash|top)|^basin$|^bowl|^tub|bathtub|^urinal|^washbasin|sink-bowl-ceramic|^plate|^mug|^cup|^vase/, part)) return p.mat === 'dark' ? null : 'ceramic';
  if (has(/^(tap|spout|mixer|faucet|flush|shower-(head|arm|riser|knob|plate)|basin-drain|sink-drain|towel-rail|rail-bar)/, part) && p.metalness > 0.3) return 'chrome';
  if (has(/lamp-?shade|^shade|lampshade/, part)) return 'shade';
  // ---- by the furniture kit's material key
  switch (p.mat) {
    case 'metal': return 'steel';
    case 'blackMetal': return 'darkMetal';
    case 'brass': return 'brass';
    case 'granite': return has(/panel|glass/, part) ? 'screen' : 'stone';
    case 'quartz': return 'stone';
    case 'gloss': return 'lacquer';
    case 'white': case 'shutterWhite': case 'laminate': case 'paint': return 'satin';
    case 'wood': case 'walnut': return 'veneer';
    case 'weave': case 'linen': case 'sofa': case 'pad': case 'cover': case 'headboard': case 'drape': case 'rug': case 'felt': case 'shag': case 'stripe': return has(/leather/, part) ? 'leather' : 'fabric';
    case 'cotton': case 'quilt': return 'bedding';
    case 'lamp': return 'shade';
    case 'dark': return 'plastic';
    case 'outdoor-glass': case 'outdoor-facade-glass': return 'glass';
    case 'outdoor-chrome': return 'chrome';
    case 'outdoor-metal': return 'plastic';
    case 'outdoor-timber': return 'veneer';
    case 'sheer': return null; // curtain voile: see-through cloth, not glass (a glass part is caught above by its name)
    default: break;
  }
  // ---- materials built without a key: the door hardware, the kit's fixtures, the lived-in decor (by what they were built as)
  if (p.emissive) return null;
  if (p.metalness >= 0.4) {
    if (sat > 0.18) return 'brass';
    if (p.roughness <= 0.27) return 'chrome';
    return 'steel';
  }
  if (p.decor) {
    if (p.metalness >= 0.08 && p.metalness < 0.4) return p.rgb[0] + p.rgb[1] + p.rgb[2] < 0.3 ? 'darkMetal' : 'steel';
    if (p.roughness <= 0.3) return 'ceramic';
    return null;
  }
  return null;
}

/** the clamped roughness of a class for a material built with `r` */
export function roughOf(c: PbrClass, r: number): number {
  const k = PBR[c].rough;
  return Math.max(k.min, Math.min(k.max, r * k.k));
}
