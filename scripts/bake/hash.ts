// SPEC 16.13: the inputs hash and the skip decision of `npm run bake`. Pure apart from node:crypto, so a test covers it without Blender.
import crypto from 'node:crypto';
import type { BakedManifest } from '../../src/look/baked/types';

export const sha256 = (...parts: (string | Uint8Array)[]): string => {
  const h = crypto.createHash('sha256');
  for (const p of parts) h.update(p);
  return h.digest('hex');
};

export interface HashInputs {
  /** the dumped meshes' metadata (keys, boxes, checksums, albedo...) */
  meshes: unknown;
  /** the dumped vertex buffers */
  bin: Uint8Array;
  /** everything that changes the result: quality, components, light set-up, sun directions, pipeline version */
  settings: unknown;
  /** `path:hash` of every source file of the pipeline */
  sources: string[];
}

/** Same scene geometry + same settings + same pipeline code = same hash. The clock and the machine are not in it. */
export function inputsHashOf(i: HashInputs): string {
  return sha256(JSON.stringify(i.meshes), i.bin, JSON.stringify(i.settings), i.sources.join('\n')).slice(0, 32);
}

export type BakeDecision = { action: 'skip'; reason: string } | { action: 'bake'; reason: string };

/** Skips only when a readable manifest carries the same hash and every file it names is still there. `--force` always bakes. */
export function decideBake(old: BakedManifest | null, hash: string, force: boolean, fileExists: (name: string) => boolean): BakeDecision {
  if (force) return { action: 'bake', reason: '--force' };
  if (!old) return { action: 'bake', reason: 'no usable bake yet' };
  if (old.inputsHash !== hash) return { action: 'bake', reason: 'inputs changed' };
  const files = new Set<string>([old.geometry.file]);
  for (const t of Object.values(old.atlases)) {
    for (const c of Object.values(t.static.components)) if (c) files.add(c.file);
    if (t.dyn) files.add(t.dyn.ao.file);
  }
  if (old.probes) files.add(old.probes.file);
  for (const f of files) if (!fileExists(f)) return { action: 'bake', reason: `${f} is missing` };
  return { action: 'skip', reason: 'inputs unchanged' };
}
