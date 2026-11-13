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
  /** the glowing parts, off by default: emissiveIntensity 0 is off, `lit[kind]` is the value when on */
  lens: Record<LightKind, THREE.MeshStandardMaterial>;
  setLit(kind: LightKind, on: boolean): void;
  isLit(kind: LightKind): boolean;
  dispose(): void;
}

/** Peak emissive strength of each light kind when lit. */
export const LIT: Record<LightKind, number> = { tube: 2.4, cove: 2.0, fan: 2.0 };
const WARM: Record<LightKind, string> = { tube: '#fff4de', cove: '#ffd9a8', fan: '#ffe7bd' };
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
export function createKitMaterials(fin: Finishes, paint: { wall: ((color: string) => THREE.Material) | null } = { wall: null }): KitMaterials {
  const std = (color: string, roughness: number, metalness = 0): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness });
  const tex = meshTexture();
  const veil = new THREE.MeshBasicMaterial({ color: '#6a6a6a', transparent: true, opacity: tex ? 0.4 : 0.1, depthWrite: false, side: THREE.DoubleSide });
  if (tex) { veil.map = tex; }
  const skirtColour = `#${new THREE.Color(fin.wallColor).multiplyScalar(0.9).getHexString()}`;
  const skirting = paint.wall ? paint.wall(skirtColour) : std(skirtColour, 0.8);
  const lens = {} as Record<LightKind, THREE.MeshStandardMaterial>;
  const lit = { tube: false, cove: false, fan: false };
  for (const k of ['tube', 'cove', 'fan'] as LightKind[]) {
    lens[k] = new THREE.MeshStandardMaterial({ color: OFF[k], roughness: 0.45, emissive: WARM[k], emissiveIntensity: 0 });
    lens[k].side = k === 'cove' ? THREE.DoubleSide : THREE.FrontSide;
  }
  const coveMat = std(`#${new THREE.Color(fin.ceilingColor).multiplyScalar(0.8).getHexString()}`, 1);
  const m: KitMaterials = {
    skirting: skirting as THREE.MeshStandardMaterial,
    grill: std('#3A3836', 0.5, 0.25),
    alu: std('#C8C9CB', 0.38, 0.6),
    veil,
    railing: std(fin.railingColor, 0.45, 0.35),
    fixtures: new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.5, metalness: 0 }),
    fan: std('#DCD8CE', 0.5),
    cove: coveMat,
    lens,
    setLit(kind, on) { lit[kind] = on; lens[kind].emissiveIntensity = on ? LIT[kind] : 0; lens[kind].color.set(on ? '#ffffff' : OFF[kind]); },
    isLit: (kind) => lit[kind],
    dispose() {
      for (const mat of [m.grill, m.alu, m.veil, m.railing, m.fixtures, m.fan, ...Object.values(lens)]) { mat.map?.dispose(); mat.dispose(); }
      coveMat.dispose();
      if (!paint.wall) skirting.dispose(); // the look's wall material belongs to the look
    },
  };
  return m;
}
