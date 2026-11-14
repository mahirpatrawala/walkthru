// Parses a baked-lighting manifest defensively (SPEC 16.14). Anything that is not exactly usable gives null, never a throw:
// a scene with a missing, corrupt or older-format bake renders exactly as it did before the bake existed.
import { BAKE_FORMAT_VERSION, COMPONENTS, isFiniteNumber } from './types';
import type { AtlasFiles, AtlasTier, DynAtlas, BakedManifest, ComponentFile, ComponentId, Fixture, MeshEntry, ProbeGrid, SunKey } from './types';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const vec3 = (v: unknown): [number, number, number] | null =>
  Array.isArray(v) && v.length === 3 && v.every(isFiniteNumber) ? [v[0] as number, v[1] as number, v[2] as number] : null;
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length < 256 ? v : null);
/** a file name inside the baked/ folder: no path separators, no dots-only, no scheme */
export const safeFile = (v: unknown): string | null => {
  const s = str(v);
  return s && /^[A-Za-z0-9._-]+$/.test(s) && !/^\.+$/.test(s) ? s : null;
};

function parseComponent(v: unknown): ComponentFile | null {
  if (!isObj(v)) return null;
  const file = safeFile(v.file);
  if (!file || !isFiniteNumber(v.gain) || v.gain <= 0 || !isFiniteNumber(v.bytes)) return null;
  return { file, bytes: v.bytes, gain: v.gain };
}

function parseAtlas(v: unknown): AtlasFiles | null {
  if (!isObj(v) || !isFiniteNumber(v.size) || v.size < 16 || v.size > 8192 || !isObj(v.components)) return null;
  const components: AtlasFiles['components'] = {};
  for (const c of COMPONENTS) {
    if (v.components[c] === undefined) continue;
    const f = parseComponent(v.components[c]);
    if (!f) return null;
    components[c] = f;
  }
  return { size: v.size, components };
}

function parseDyn(v: unknown): DynAtlas | null {
  if (!isObj(v) || !isFiniteNumber(v.size) || v.size < 16 || v.size > 8192) return null;
  const ao = parseComponent(v.ao);
  return ao ? { size: v.size, ao } : null;
}

function parseMesh(v: unknown): MeshEntry | null {
  if (!isObj(v)) return null;
  const { verts, checksum, uvOffset, uvCount } = v;
  if (![verts, checksum, uvOffset, uvCount].every(isFiniteNumber)) return null;
  if (v.atlas !== 'static' && v.atlas !== 'dyn') return null;
  const out: MeshEntry = { verts: verts as number, checksum: checksum as number, atlas: v.atlas, uvOffset: uvOffset as number, uvCount: uvCount as number };
  if (v.remapOffset !== undefined) {
    if (![v.remapOffset, v.remapCount, v.indexOffset, v.indexCount].every(isFiniteNumber)) return null;
    out.remapOffset = v.remapOffset as number; out.remapCount = v.remapCount as number;
    out.indexOffset = v.indexOffset as number; out.indexCount = v.indexCount as number;
  }
  if (out.verts < 3 || out.uvCount < out.verts || out.uvOffset < 0) return null;
  return out;
}

function parseProbes(v: unknown): ProbeGrid | null {
  if (!isObj(v)) return null;
  const origin = vec3(v.origin), spacing = vec3(v.spacing), dims = vec3(v.dims);
  const file = safeFile(v.file);
  if (!origin || !spacing || !dims || !file || v.coeffs !== 9 || !Array.isArray(v.components)) return null;
  if (!dims.every((d) => Number.isInteger(d) && d >= 1 && d <= 256) || !spacing.every((s) => s > 0)) return null;
  const components = v.components.filter((c): c is ComponentId => (COMPONENTS as readonly string[]).includes(c as string));
  if (components.length !== v.components.length || components.length === 0) return null;
  if (!isFiniteNumber(v.bytes) || !isFiniteNumber(v.validCount)) return null;
  return { origin, spacing, dims, coeffs: 9, components, file, bytes: v.bytes, validCount: v.validCount };
}

/** Parses manifest.json. Returns null when it is missing, malformed, from another format version, or lacks what the runtime needs. */
export function parseManifest(input: unknown): BakedManifest | null {
  try {
    if (!isObj(input) || input.version !== BAKE_FORMAT_VERSION) return null;
    const sceneId = str(input.sceneId), inputsHash = str(input.inputsHash);
    if (!sceneId || !inputsHash || !isObj(input.pipeline) || !isObj(input.atlases) || !isObj(input.geometry) || !isObj(input.meshes)) return null;
    const p = input.pipeline;
    if (!isFiniteNumber(p.version) || !isFiniteNumber(p.samples) || !isFiniteNumber(p.texelsPerM)) return null;
    const sun: SunKey[] = [];
    if (!Array.isArray(input.sun)) return null;
    for (const s of input.sun) {
      if (!isObj(s)) return null;
      const toSun = vec3(s.toSun);
      if (!toSun || !isFiniteNumber(s.hour) || (s.id !== 'sun0' && s.id !== 'sun1' && s.id !== 'sun2')) return null;
      sun.push({ id: s.id, hour: s.hour, toSun });
    }
    const atlases = {} as BakedManifest['atlases'];
    for (const tier of ['medium', 'low'] as AtlasTier[]) {
      const a = input.atlases[tier];
      if (!isObj(a)) return null;
      const st = parseAtlas(a.static);
      if (!st || !st.components.sky) return null;
      const dyn = a.dyn === undefined ? undefined : parseDyn(a.dyn);
      if (a.dyn !== undefined && !dyn) return null;
      atlases[tier] = dyn ? { static: st, dyn } : { static: st };
    }
    const geoFile = safeFile(input.geometry.file);
    if (!geoFile || !isFiniteNumber(input.geometry.bytes) || !isFiniteNumber(input.geometry.uvElements)) return null;
    const meshes: Record<string, MeshEntry> = {};
    for (const [k, v] of Object.entries(input.meshes)) {
      const m = parseMesh(v);
      if (!m) return null;
      meshes[k] = m;
    }
    const probes = input.probes === undefined ? undefined : parseProbes(input.probes);
    if (input.probes !== undefined && !probes) return null;
    const fixtures: Fixture[] = [];
    if (Array.isArray(input.fixtures)) {
      for (const f of input.fixtures) {
        if (!isObj(f)) return null;
        const position = vec3(f.position);
        if (!position || f.kind !== 'downlight' || !isFiniteNumber(f.radiusM) || typeof f.roomId !== 'string') return null;
        fixtures.push({ kind: 'downlight', position, radiusM: f.radiusM, roomId: f.roomId });
      }
    }
    const cal = isObj(input.calibration) ? input.calibration : {};
    const t = isObj(input.totals) ? input.totals : {};
    const out: BakedManifest = {
      version: BAKE_FORMAT_VERSION, sceneId, inputsHash,
      pipeline: {
        version: p.version as number, blender: String(p.blender ?? ''), quality: p.quality === 'final' ? 'final' : 'draft', samples: p.samples as number,
        denoised: p.denoised === true, texelsPerM: p.texelsPerM as number,
        presets: Array.isArray(p.presets) ? p.presets.filter((x): x is string => typeof x === 'string') : [],
        seconds: isFiniteNumber(p.seconds) ? p.seconds : 0, createdAt: String(p.createdAt ?? ''),
      },
      sun, atlases, geometry: { file: geoFile, bytes: input.geometry.bytes, uvElements: input.geometry.uvElements }, meshes, fixtures,
      calibration: { lampMeanIrradiance: isFiniteNumber(cal.lampMeanIrradiance) ? cal.lampMeanIrradiance : 0, coveMeanIrradiance: isFiniteNumber(cal.coveMeanIrradiance) ? cal.coveMeanIrradiance : 0 },
      totals: { bytes: isFiniteNumber(t.bytes) ? t.bytes : 0, meshes: isFiniteNumber(t.meshes) ? t.meshes : 0, staticMeshes: isFiniteNumber(t.staticMeshes) ? t.staticMeshes : 0, dynMeshes: isFiniteNumber(t.dynMeshes) ? t.dynMeshes : 0 },
    };
    if (probes) out.probes = probes;
    return out;
  } catch {
    return null;
  }
}
