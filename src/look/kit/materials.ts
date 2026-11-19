// Owned by C11 look-kit. The few shared materials of the kit's own meshes (paint, aluminium, plastic, the glowing parts). Floors come from
// look/materials.ts (they need the look's shader); everything here is a plain MeshStandardMaterial or MeshBasicMaterial.
import * as THREE from 'three';
import type { Finishes } from '../../types';

export type LightKind = 'tube' | 'cove' | 'fan';

export interface KitMaterials {
  skirting: THREE.Material; grill: THREE.MeshStandardMaterial; alu: THREE.MeshStandardMaterial; veil: THREE.MeshBasicMaterial;
  railing: THREE.MeshStandardMaterial;
  /** one material for every painted fixture, coloured per vertex (build.ts PAINT) */
  fixtures: THREE.MeshStandardMaterial;
  /** the fan's blades, same paint as its body */
  fan: THREE.MeshStandardMaterial;
  cove: THREE.Material;
  /** a bathroom mirror's glass: per-vertex gradient, glossy */
  mirror: THREE.MeshStandardMaterial;
  /** the glass of the recessed downlights (walkthruLight 'lamp'): off by default, the look lights it with the evening */
  downlight: THREE.MeshStandardMaterial;
  /** the glowing parts, off by default: emissiveIntensity 0 is off, `lit[kind]` is the value when on */
  lens: Record<LightKind, THREE.MeshStandardMaterial>;
  setLit(kind: LightKind, on: boolean): void;
  /** 0..1 between the unlit and the fully lit lens (SPEC 16.26: a cove LED glows part way by day) */
  setLevel(kind: LightKind, level: number): void;
  isLit(kind: LightKind): boolean;
  dispose(): void;
}

/** Peak emissive strength of each light kind when lit. */
export const LIT: Record<LightKind, number> = { tube: 2.4, cove: 2.0, fan: 2.0 };
/** a recessed downlight's glass at full level (a small bright disc: bloom takes it from here on the tiers that have it) */
export const DOWNLIGHT_LIT = 3.2;
/** what a lens gives when off: nothing, but the cove's diffuser (the back of the reveal under the ceiling, a white strip in a recess) keeps a faint
 *  lift so the reveal reads as a pale line by day and never as a dark one */
export const UNLIT: Record<LightKind, number> = { tube: 0, cove: 0.2, fan: 0 };
const WARM: Record<LightKind, string> = { tube: '#fff4de', cove: '#ffd9a8', fan: '#ffe7bd' };
const WHITE = new THREE.Color('#ffffff');
const OFF: Record<LightKind, string> = { tube: '#c8c6c0', cove: '#e0dcd4', fan: '#d3d0ca' };

/** A 32 px tile of fine mesh: transparent cells, a faint wire along two edges. Null without a DOM (Node). */
function meshTexture(): THREE.Texture | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 32; c.height = 32;
  const g = c.getContext('2d');
  if (!g) return null;
  g.clearRect(0, 0, 32, 32);
  g.fillStyle = 'rgba(30,30,30,0.9)';
  g.fillRect(0, 0, 32, 2);
  g.fillRect(0, 0, 2, 32);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** `paint` is the look's own wall material for skirting (so it carries the same floor-edge shading as the wall above it), when there is a look. */
export function createKitMaterials(fin: Finishes, paint: { wall: ((color: string) => THREE.Material) | null } = { wall: null }, trim: { skirting?: string | null; grill?: string | null } = {}): KitMaterials {
  const std = (color: string, roughness: number, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const tex = meshTexture();
  const veil = new THREE.MeshBasicMaterial({ color: '#6a6a6a', transparent: true, opacity: tex ? 0.4 : 0.1, depthWrite: false, side: THREE.DoubleSide });
  if (tex) { veil.map = tex; }
  // the skirting is the pack's accent (SPEC 16.18), else the wall's own paint a shade deeper; its own material, with a little sheen so the bevels catch the light
  const skirtColour = trim.skirting ?? `#${new THREE.Color(fin.wallColor).multiplyScalar(0.94).getHexString()}`;
  void paint;
  const skirting = std(skirtColour, 0.42);
  // emissiveIntensity is the FULL-ON value: the look scales it by the fixture's level (interior.ts reads it once), so it must not start at 0
  const downlight = new THREE.MeshStandardMaterial({ color: '#E9E5DC', roughness: 0.4, emissive: '#FFE3B5', emissiveIntensity: DOWNLIGHT_LIT });
  const lens = {} as Record<LightKind, THREE.MeshStandardMaterial>;
  const lit = { tube: false, cove: false, fan: false };
  for (const k of ['tube', 'cove', 'fan'] as LightKind[]) {
    lens[k] = new THREE.MeshStandardMaterial({ color: OFF[k], roughness: 0.45, emissive: WARM[k], emissiveIntensity: UNLIT[k] });
    lens[k].side = k === 'cove' ? THREE.DoubleSide : THREE.FrontSide;
  }
  const coveMat = std(`#${new THREE.Color(fin.ceilingColor).multiplyScalar(0.94).getHexString()}`, 1);
  const m: KitMaterials = {
    skirting: skirting as THREE.MeshStandardMaterial,
    grill: std(trim.grill ?? '#3A3836', trim.grill ? 0.4 : 0.5, trim.grill ? 0.05 : 0.25),
    alu: std('#C8C9CB', 0.38, 0.6),
    veil,
    // a near-black rail reads as a black pole against bright walls (and, with metalness and no environment, as a hole): a mid-tone powder-coated grey instead
    railing: std(((c) => (c.getHSL({ h: 0, s: 0, l: 0 }).l < 0.3 ? `#${c.lerp(new THREE.Color('#8A9094'), 0.6).getHexString()}` : fin.railingColor))(new THREE.Color(fin.railingColor)), 0.45, 0.12),
    fixtures: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0 }),
    fan: std('#DCD8CE', 0.5),
    cove: coveMat,
    downlight,
    mirror: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.12, metalness: 0.35 }),
    lens,
    setLit(kind, on) { m.setLevel(kind, on ? 1 : 0); },
    setLevel(kind, level) {
      const k = Math.min(1, Math.max(0, level));
      lit[kind] = k > 0.2;
      lens[kind].emissiveIntensity = UNLIT[kind] + (LIT[kind] - UNLIT[kind]) * k;
      lens[kind].color.set(OFF[kind]).lerp(WHITE, k);
    },
    isLit: (kind) => lit[kind],
    dispose() {
      for (const mat of [m.grill, m.alu, m.veil, m.railing, m.fixtures, m.fan, ...Object.values(lens)]) { mat.map?.dispose(); mat.dispose(); }
      coveMat.dispose();
      downlight.dispose();
      m.mirror.dispose();
      skirting.dispose();
    },
  };
  // names the 2K layer reads (SPEC 16.24); a name changes nothing at Off or 1K
  m.grill.name = 'kit-grill'; m.railing.name = 'kit-railing'; m.fixtures.name = 'kit-fixtures'; m.fan.name = 'kit-fan'; m.alu.name = 'kit-alu';
  return m;
}
