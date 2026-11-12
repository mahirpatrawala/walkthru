// Owned by C2. Stub from C0: signature only (SPEC 7.1, speeds in 2.3).
import type { Character } from './character';
import type { Input } from './controls';
import type { Grid } from '../types';

/** moves and turns the character from input, returns the speed actually achieved */
export function stepLocomotion(ch: Character, input: Input, cameraYawDeg: number, grid: Grid, dt: number): number {
  throw new Error('not implemented: C2 stepLocomotion');
}
