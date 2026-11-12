// Owned by C6 per SPEC section 7. Stub from C0.
// SPEC-GAP: 7.1 lists no signature for this file, but C5's scope says it creates the FrameStore
// ("FrameStore creation from a dropped video or images (C6 uses it)") and C5 may not edit C6's files.
// C0 provides the factory below so both chunks can compile against one name. C6 owns the body;
// if C5 needs it before C6 lands, the integrator decides who implements it.
import type { FrameStore } from './context';

export function createFrameStore(): FrameStore {
  throw new Error('not implemented: C6 createFrameStore');
}
