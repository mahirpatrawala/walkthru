// A small, permanent label for made-up scenes (SPEC 16.2 spirit: nothing synthetic may pass for a real home).
// Pure text rule + a tiny DOM tag placed under the room chip. Kept out of hud.ts so HUD changes elsewhere merge cleanly.
import type { PropertyFile } from '../types';

/** The label for a test or synthetic scene, or null for a real home. */
export function sceneTagText(p: Pick<PropertyFile, 'id' | 'subtitle'>): string | null {
  if (/^test-/.test(p.id)) return 'Test scene. Made-up flat, not a real home.';
  if (/synthetic/i.test(p.subtitle ?? '') || /^video-sample/.test(p.id)) return 'Sample scene. Not a real home.';
  return null;
}

/** Mounts the tag under the room chip (which grows to two lines on a phone). Returns the remover. */
export function mountSceneTag(hudRoot: HTMLElement, text: string): () => void {
  const tag = document.createElement('div');
  tag.className = 'wt-scene-tag';
  tag.dataset.testid = 'scene-tag';
  tag.textContent = text;
  hudRoot.appendChild(tag);
  const chip = hudRoot.querySelector<HTMLElement>('.wt-chip');
  const place = (): void => {
    const h = chip && !chip.hidden ? chip.offsetHeight : 0;
    tag.style.setProperty('--wt-chip-h', `${Math.max(h, 40)}px`);
  };
  place();
  const ro = chip && typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
  if (chip) ro?.observe(chip);
  const mo = chip && typeof MutationObserver !== 'undefined' ? new MutationObserver(place) : null;
  if (chip) mo?.observe(chip, { attributes: true, attributeFilter: ['hidden'] });
  return () => { ro?.disconnect(); mo?.disconnect(); tag.remove(); };
}
