// Owned by C9. SPEC 14.4 / 14.6: the reconstruction backend registry.
import type { MediaOptions, ReconstructionBackend } from '../types';
import { CloudBackend } from './backends/cloud';
import { FakeBackend } from './backends/fake';
import { LocalColmapBrushBackend } from './backends/local-colmap-brush';

export type { ReconstructionBackend } from '../types';

/** Resolves `options.backend`. 'none' has no backend: the pipeline skips reconstruction. */
export function getBackend(name: MediaOptions['backend']): ReconstructionBackend | null {
  switch (name) {
    case 'local': return new LocalColmapBrushBackend();
    case 'cloud': return new CloudBackend();
    case 'fake': return new FakeBackend();
    case 'none': return null;
  }
}
export { CloudBackend, FakeBackend, LocalColmapBrushBackend };
