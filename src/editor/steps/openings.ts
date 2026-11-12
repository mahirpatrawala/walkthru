// Owned by C5. Stub from C0: a step whose panel says "Coming soon" (SPEC 7).
import type { EditorStep } from '../context';

export const step: EditorStep = {
  id: 'openings',
  title: 'Openings',
  mount(panel) {
    panel.textContent = 'Coming soon';
  },
  unmount() {},
  isDone() {
    return false;
  },
};
