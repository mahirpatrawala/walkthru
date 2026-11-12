// Owned by C6. Stub from C0: a step whose panel says "Coming soon" (SPEC 7).
import type { EditorStep } from '../context';

export const step: EditorStep = {
  id: 'spawn',
  title: 'Spawn and save',
  mount(panel) {
    panel.textContent = 'Coming soon';
  },
  unmount() {},
  isDone() {
    return false;
  },
};
