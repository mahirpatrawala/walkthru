// A one-way hook so furnish mode can ask "does this item sit in a wardrobe's shutter swing?" without importing the wardrobe
// controller (which needs three and the HUD). The controller registers itself when the buyer page starts; headless furnish
// tests never register one, so the answer there is always null.
import type { Box } from '../types';

export type SwingProvider = (box: Box, selfId?: string) => string | null;
let provider: SwingProvider | null = null;

export function setSwingProvider(p: SwingProvider | null): void {
  provider = p;
}

/** "Wardrobe shutters need 44 cm to open here." when `box` sits in a wardrobe's swing, else null. `selfId` is skipped. */
export function swingNoteFor(box: Box, selfId?: string): string | null {
  return provider ? provider(box, selfId) : null;
}

/** The verdict message with the swing sentence added when there is one. */
export function withSwingNote(message: string, box: Box, selfId?: string): string {
  const note = swingNoteFor(box, selfId);
  return note ? `${message} ${note}` : message;
}
