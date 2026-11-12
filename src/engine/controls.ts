// Owned by C2. Stub from C0: signatures only (SPEC 7.1, controls in 2.3).

export interface PointerEvt { type: 'down' | 'move' | 'up'; ndcX: number; ndcY: number; clientX: number; clientY: number }
export interface Input {
  /** -1..1; moveY +1 = forward */
  moveX: number; moveY: number; jog: boolean;
  /** consume accumulated look drag (px) and zoom (wheel notches / pinch) since the last call */
  takeLook(): { dx: number; dy: number; zoom: number };
  on(evt: 'interact' | 'cancel' | 'measure' | 'furnish' | 'rotate-left' | 'rotate-right' | 'rotate-90', cb: () => void): () => void;
  onTap(cb: (e: PointerEvt) => void): () => void;
  /** claimant returns true on 'down' to receive that pointer's moves and up instead of the look drag */
  claimPointer(fn: ((e: PointerEvt) => boolean) | null): void;
  /** in 'rotate' mode the E key emits 'rotate-right' instead of 'interact' (furnish mode) */
  setInteractKeyMode(mode: 'interact' | 'rotate'): void;
  dispose(): void;
}
export function createInput(el: HTMLElement): Input {
  throw new Error('not implemented: C2 createInput');
}
