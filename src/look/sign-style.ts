// SPEC 16.19: how the boards over doors look. The old pack look is a dark plate with a gold rule (it dominated a white passage); the clean packs use
// a small light plate with thin dark text. The words come from the drawing and the building file, as before.
import { getStyle } from './style';

export interface SignLook { bg: string; fg: string; border: string | null; /** scales the board's height (and so its text) */ scale: number; weight: number }

const PLATE: SignLook = { bg: '#23292E', fg: '#F6F2E8', border: '#C9A657', scale: 1, weight: 700 };
const CALM: SignLook = { bg: '#F6F4F0', fg: '#2B2D31', border: '#CFCBC3', scale: 0.7, weight: 500 };

export function signLook(): SignLook {
  const id = getStyle().pack.id;
  return id.startsWith('clean-contrast') ? CALM : PLATE;
}
