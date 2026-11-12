// Owned by C11c. SPEC 16.7: the type shim for the vendored oil-paint files (vendor/oilpaint, plain JavaScript, MIT, never edited).
// Only the exports the adapter calls are typed.
declare module '*/vendor/oilpaint/src/oilpaint/index.js' {
  import type * as THREE from 'three';
  export type Shared = Record<string, { value: unknown }>;
  export function createShared(): Shared;
  export function createBrushSheet(): THREE.Texture;
  export function createShade(
    renderer: THREE.WebGLRenderer, shared: Shared, still: THREE.Object3D,
    opts?: { sun?: THREE.Vector3; size?: [number, number]; box?: [number, number]; centre?: [number, number, number]; back?: number; near?: number; far?: number },
  ): { update(scene: THREE.Object3D, at: THREE.Vector3): void };
  export function createFrame(
    renderer: THREE.WebGLRenderer, shared: Shared, opts?: { samples?: number },
  ): {
    target: THREE.WebGLRenderTarget;
    uniforms: Record<string, { value: unknown }>;
    resize(): void;
    render(world: THREE.Object3D, camera: THREE.Camera): void;
  };
  export function pinDabs(
    shared: Shared,
    palettes: number[][][],
    parts: { mesh: THREE.Mesh; count: number; accept?(p: THREE.Vector3): boolean; style(p: THREE.Vector3, n: THREE.Vector3): { pal: number; size: [number, number]; dir: THREE.Vector3 } }[],
  ): { mesh: THREE.Mesh; count: number; update(): void };
}
declare module '*/vendor/oilpaint/src/night/kit.js' {
  import type * as THREE from 'three';
  import type { Shared } from '*/vendor/oilpaint/src/oilpaint/index.js';
  export interface KitPalette { l: number[]; m?: number[]; s?: number[]; own?: number[]; glow?: boolean | number }
  export interface ScatterOpts { grain?: THREE.Vector3 | number[] | null; stroke?: [number, number]; density?: number; tone?: number; free?: boolean; lift?: number; smooth?: boolean }
  export function createKit(
    shared: Shared,
    opts: { palettes: Record<string, KitPalette>; head?: string; light: string; origin?: number[]; seed?: number; haze?: boolean; order?: number },
  ): {
    stroke(at: THREE.Vector3, normal: THREE.Vector3, run: THREE.Vector3, across: number, along: number, pal: string, tone?: number, height?: number): void;
    add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, pal: string, opts?: ScatterOpts): void;
    tri(pa: number[], pb: number[], pc: number[], pal: string, opts?: ScatterOpts): void;
    build(): { group: THREE.Group; under: THREE.Mesh; strokes: THREE.Mesh; count: number };
    rand(): number;
  };
}
