// Owned by C11b. SPEC 16.6.2 to 16.6.3: fetches a person body (MPFB, built by tools/make_people.py) and our six
// retargeted clips, and hands back a parsed glTF the Character can adopt. A body is fetched only when it is chosen.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { buildNameMap, idleVariants, liePoseClip, readRest, retargetClipsAuto } from './retarget';

/** The family (SPEC 16.6.2): a man, a woman, an elderly parent and a child. `mannequin` is the test rig and the fallback. */
export type PersonBody = 'man' | 'woman' | 'elder' | 'child';
export type BodyKind = 'mannequin' | PersonBody;
export const PERSON_BODIES: readonly PersonBody[] = ['man', 'woman', 'elder', 'child'];
export type PersonTier = 'low' | 'medium' | 'high';

export const PEOPLE_BASE = '/characters/';
export const CLIPS_URL = `${PEOPLE_BASE}clips.glb`;
export function personUrl(body: PersonBody, tier: PersonTier): string {
  return `${PEOPLE_BASE}person-${body}${tier === 'low' ? '-low' : ''}.glb`;
}

/** Bytes of body and clip files fetched so far (the weight checks read this). */
export const peopleStats = { bytes: 0, files: [] as { url: string; bytes: number }[], lastRetarget: null as null | { method: 'rename' | 'world'; maxRestDiffDeg: number; ms: number } };

const buffers = new Map<string, Promise<ArrayBuffer>>();
function fetchBuffer(url: string): Promise<ArrayBuffer> {
  let p = buffers.get(url);
  if (!p) {
    p = (async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Character: ${url} answered HTTP ${res.status}.`);
      const buf = await res.arrayBuffer();
      const magic = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(4, buf.byteLength)));
      if (magic !== 'glTF') throw new Error(`Character: ${url} is not a GLB file (it starts with "${magic}").`);
      peopleStats.bytes += buf.byteLength;
      peopleStats.files.push({ url, bytes: buf.byteLength });
      return buf;
    })();
    buffers.set(url, p);
    p.catch(() => buffers.delete(url));
  }
  return p;
}

function loader(): GLTFLoader {
  const l = new GLTFLoader();
  l.setMeshoptDecoder(MeshoptDecoder);
  return l;
}

/** Starts the downloads a body needs (its file and the clips) so they overlap with the rest of the page boot. Errors are left to the real load. */
export function prefetchPerson(body: PersonBody, tier: PersonTier): void {
  void fetchBuffer(personUrl(body, tier)).catch(() => {});
  void fetchBuffer(CLIPS_URL).catch(() => {});
}

let clipsGltf: Promise<GLTF> | null = null;
function clips(): Promise<GLTF> {
  if (!clipsGltf) {
    clipsGltf = fetchBuffer(CLIPS_URL).then((b) => loader().parseAsync(b, PEOPLE_BASE));
    clipsGltf.catch(() => { clipsGltf = null; });
  }
  return clipsGltf;
}

/**
 * Parses a body (a fresh skeleton every call) and retargets the six clips onto it. The result is what `Character`
 * expects: a scene with one or more skinned meshes and the six clips by their usual names.
 */
export async function loadPersonGLTF(body: PersonBody, tier: PersonTier): Promise<GLTF> {
  const url = personUrl(body, tier);
  const [buf, src] = await Promise.all([fetchBuffer(url), clips()]);
  const gltf = await loader().parseAsync(buf.slice(0), PEOPLE_BASE);
  retargetOnto(gltf, src);
  return gltf;
}

/** Retargets `src`'s clips onto `gltf`'s skeleton, in place (replaces `gltf.animations`). */
export function retargetOnto(gltf: GLTF, src: GLTF): void {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  let skeleton: THREE.Skeleton | null = null;
  gltf.scene.traverse((o) => { const s = o as THREE.SkinnedMesh; if (s.isSkinnedMesh && !skeleton) skeleton = s.skeleton; });
  if (!skeleton) throw new Error('Character: the body has no skeleton.');
  const boneNames = (skeleton as THREE.Skeleton).bones.map((b) => b.name);
  const srcBones = new Set<string>();
  for (const a of src.animations) for (const tr of a.tracks) srcBones.add(tr.name.slice(0, tr.name.lastIndexOf('.')));
  const nameMap = buildNameMap([...srcBones], boneNames);
  const srcRest = readRest(src.scene, new Set([...srcBones]));
  const tgtRest = readRest(gltf.scene, new Set(boneNames));
  const r = retargetClipsAuto(src.animations, srcRest, tgtRest, nameMap);
  gltf.animations = [...r.clips, ...liePoseClip(r.clips, tgtRest, nameMap), ...idleVariants(r.clips, tgtRest, nameMap)];
  peopleStats.lastRetarget = { method: r.method, maxRestDiffDeg: r.maxRestDiffDeg, ms: (typeof performance !== 'undefined' ? performance.now() : 0) - t0 };
}
