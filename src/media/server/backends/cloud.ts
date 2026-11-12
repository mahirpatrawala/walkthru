// Owned by C9. SPEC 14.6 "Cloud later": conforms to the interface, reports "not configured".
// A real version uploads `imagesDir`, polls, downloads PLYs into `workDir` and returns the same ReconResult.
import type { ReconHooks, ReconInput, ReconResult, ReconstructionBackend } from '../../types';

export class CloudBackend implements ReconstructionBackend {
  readonly name = 'cloud';
  async available(): Promise<{ ok: boolean; missing: string[] }> {
    return { ok: false, missing: ['WALKTHRU_MODAL_URL'] };
  }
  async reconstruct(_input: ReconInput, _hooks: ReconHooks): Promise<ReconResult> {
    return { fragments: [], upPreset: 'flip-x', warnings: ['The cloud backend is not configured.'] };
  }
}
