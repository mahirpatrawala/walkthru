// A small, permanent label for made-up scenes (SPEC 16.2 spirit: nothing synthetic may pass for a real home).
// Pure text rule + a tiny DOM tag placed under the room chip. Kept out of hud.ts so HUD changes elsewhere merge cleanly.
import type { PropertyFile } from '../types';
import { SAMPLE_UPLOAD_TAG, UPLOAD_TAG, isLocalHomeId } from '../upload/tag';

/** Where a scene's picture of the home comes from: a real drawing, a made-up sample, a phone video, or a plan the visitor uploaded in this browser. */
export type SceneOrigin = 'real' | 'sample' | 'video' | 'upload';

/** Test scenes and any scene that calls itself synthetic or a sample are made up; video scenes (and anything with a scan) come from a phone video. */
export function sceneOrigin(p: Pick<PropertyFile, 'id' | 'subtitle'> & { hasSplat?: boolean }): SceneOrigin {
  if (isLocalHomeId(p.id)) return 'upload';
  if (/^test-/.test(p.id)) return 'sample';
  if (/^video-/.test(p.id)) return 'video';
  if (/synthetic|sample/i.test(p.subtitle ?? '')) return 'sample';
  return p.hasSplat ? 'video' : 'real';
}

/** The short tag on a home card and on the start-room page. */
export const ORIGIN_TAG: Record<SceneOrigin, string> = {
  real: 'Your drawing',
  sample: 'Sample drawing \u00b7 made-up',
  video: 'From a phone video',
  upload: UPLOAD_TAG,
};

/** The label for a test or synthetic scene, or null for a real home. */
export function sceneTagText(p: Pick<PropertyFile, 'id' | 'subtitle'> & { spaceKind?: PropertyFile['spaceKind'] }): string | null {
  if (isLocalHomeId(p.id)) return /made-up/i.test(p.subtitle ?? '') ? SAMPLE_UPLOAD_TAG : UPLOAD_TAG;
  // a plan taken from a published brochure is not made-up: say what is the plan's and what is illustrative
  if (/published (builder )?brochure/i.test(p.subtitle ?? '')) return p.spaceKind && p.spaceKind !== 'home' ? 'Sample building. Plan follows a published brochure, scaled, not measured.' : 'Sample building. Plan follows a published brochure; furniture is illustrative.';
  // a shared space of a building (a gym, a lobby, a hall) is a room, not a flat
  if (/^test-/.test(p.id)) return p.spaceKind && p.spaceKind !== 'home' ? 'Sample space. Made up, not a real place.' : 'Sample home. Made up, not a real home.';
  if (/synthetic|sample/i.test(p.subtitle ?? '')) return 'Sample home. Made up, not a real home.';
  return null;
}

/** Mounts the quiet line as the third line of the identity card (top left of the HUD). Returns the remover. */
export function mountSceneTag(hudRoot: HTMLElement, text: string): () => void {
  const tag = document.createElement('div');
  tag.className = 'wt-scene-tag';
  tag.dataset.testid = 'scene-tag';
  tag.textContent = text;
  (hudRoot.querySelector('.wt-id-text') ?? hudRoot).appendChild(tag);
  return () => tag.remove();
}
