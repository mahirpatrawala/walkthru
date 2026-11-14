// SPEC 16.14 "Baked lighting". Shared types of the bake pipeline (tools/bake, scripts/bake-scene.ts) and the runtime loader.
// Pure: no three, no DOM, no node. The pipeline writes a manifest with these shapes; the runtime parses it defensively.

/** Bump when the manifest layout or the meaning of a baked channel changes. A runtime that sees another number ignores the bake. */
export const BAKE_FORMAT_VERSION = 1;
/** Bump when the bake script changes in a way that should re-bake every scene (it is part of the inputs hash). */
export const BAKE_PIPELINE_VERSION = 1;

/** The additive light components. Every one is baked as irradiance (no albedo) from one light group, so the runtime can mix them. */
export const COMPONENTS = ['sky', 'sun0', 'sun1', 'sun2', 'lamps', 'cove', 'ao'] as const;
/** the components that are light (probes carry these); `ao` is the static ambient occlusion that shades the ambient fill */
export const LIGHT_COMPONENTS = ['sky', 'sun0', 'sun1', 'sun2', 'lamps', 'cove'] as const;
export type ComponentId = (typeof COMPONENTS)[number];

export type BakeQuality = 'draft' | 'final';
export type AtlasTier = 'medium' | 'low';

/** Which atlas a mesh lives in: the room's lightmap (shell + kit + fixed built-ins) or the per-object AO atlas of movable pieces. */
export type AtlasKind = 'static' | 'dyn';

/** One baked light component inside one atlas tier. The pixel is `gain * (byte / 255) ^ GAMMA` per channel. */
export interface ComponentFile {
  file: string;
  bytes: number;
  /** decoded value of byte 255, in the unit of the component: lightmap irradiance in three's units for a unit light (see 16.14) */
  gain: number;
}

export interface AtlasFiles {
  size: number;
  components: Partial<Record<ComponentId, ComponentFile>>;
}
/** The per-object AO of movable pieces: one linear picture (byte / 255 = how open the surface is), `gain` is always 1. */
export interface DynAtlas { size: number; ao: ComponentFile }

/** The encoding of the component pictures: byte -> (byte/255)^GAMMA * gain */
export const COMPONENT_GAMMA = 2.0;

export interface SunKey {
  id: 'sun0' | 'sun1' | 'sun2';
  /** the look preset hour this sun stands for (Morning 8.5, Afternoon 15, Evening 17.8) */
  hour: number;
  /** unit vector from the scene towards the sun, y up (the same as sun.ts gives at that hour) */
  toSun: [number, number, number];
}

/** A mesh the bake knows, keyed by its stable path. */
export interface MeshEntry {
  /** vertex count of the runtime geometry the UVs were made for; a mismatch means the mesh changed and the entry is ignored */
  verts: number;
  /** cheap checksum of the local positions (16.14), same function on both sides */
  checksum: number;
  atlas: AtlasKind;
  /** element offset into uv.bin (a Uint16 pair per vertex of the baked geometry) */
  uvOffset: number;
  /** vertices of the baked geometry (>= verts when the unwrap had to split vertices) */
  uvCount: number;
  /** when the unwrap split vertices: element offset and length of the Uint32 `source vertex` list, then of the new index list */
  remapOffset?: number;
  remapCount?: number;
  indexOffset?: number;
  indexCount?: number;
}

export interface ProbeGrid {
  origin: [number, number, number];
  spacing: [number, number, number];
  dims: [number, number, number];
  /** 9 (L2) coefficients per colour channel per component, Float16 in probes.bin, probe-major, then component, then coefficient, then rgb */
  coeffs: 9;
  components: ComponentId[];
  file: string;
  bytes: number;
  /** probe positions that were baked (the rest copy the nearest baked one) */
  validCount: number;
}

export interface Fixture {
  kind: 'downlight';
  position: [number, number, number];
  radiusM: number;
  roomId: string;
}

export interface BakedManifest {
  version: number;
  sceneId: string;
  inputsHash: string;
  pipeline: {
    version: number;
    blender: string;
    quality: BakeQuality;
    samples: number;
    denoised: boolean;
    /** texels per metre on a floor or wall of the static atlas */
    texelsPerM: number;
    presets: string[];
    seconds: number;
    createdAt: string;
  };
  sun: SunKey[];
  /** `<tier>` -> picture files. `high` uses `medium`. */
  atlases: Record<AtlasTier, { static: AtlasFiles; dyn?: DynAtlas }>;
  /** uv.bin: a Uint16 (u, v) pair per vertex of every baked mesh (`uvElements` Uint16 values), then the Uint32 remap and index lists */
  geometry: { file: string; bytes: number; uvElements: number };
  meshes: Record<string, MeshEntry>;
  probes?: ProbeGrid;
  fixtures: Fixture[];
  /** calibration notes: what the lamp gain was normalised to (mean floor irradiance of a lit room, three units) */
  calibration: { lampMeanIrradiance: number; coveMeanIrradiance: number };
  totals: { bytes: number; meshes: number; staticMeshes: number; dynMeshes: number };
}

// ---------------------------------------------------------------- the dump the page exports (16.14, step 1)

export interface DumpMesh {
  key: string;
  /** static = shell + kit + tagged built-ins; dyn = movable (furniture, decor, door leaves) */
  cls: AtlasKind;
  /** the furniture item or decor group this mesh belongs to (dyn only): its AO is baked alone */
  group?: string;
  verts: number;
  /** triangle count of the index (or verts / 3) */
  tris: number;
  indexed: boolean;
  bbox: [number, number, number, number, number, number];
  checksum: number;
  /** linear albedo used for bounce: material colour (x vertex colours are exported separately) */
  albedo: [number, number, number];
  hasColors: boolean;
  /** emission when lit, linear rgb; only for tagged fixtures */
  emissive?: [number, number, number];
  light?: 'tube' | 'cove' | 'fan' | 'lamp';
  /** byte offsets of the arrays in dump.bin */
  posOffset: number;
  norOffset: number;
  colOffset?: number;
  idxOffset?: number;
  /** names of things that decide how the surface is lit: shell surface kind for texel density tiers */
  surface: 'floor' | 'wall' | 'ceiling' | 'kit' | 'other' | 'furniture';
}

export interface SceneDump {
  version: 1;
  sceneId: string;
  wallHeightM: number;
  meshes: DumpMesh[];
  /** the three.js version and the page's user agent, recorded in the manifest */
  exporter: string;
}

// ---------------------------------------------------------------- small shared helpers

export const isFiniteNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
