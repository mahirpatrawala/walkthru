// A reader result (proposal + extras) becomes a home: the same steps the editor takes for an imported drawing (`applyProposal`), a spawn in the
// largest whole living room, and a title. The gallery's sample homes (scripts/make-sample-homes.ts) and the browser upload both build theirs here,
// so what you walk is what the reader read and nothing else. Pure: no DOM, no Node, no network.
import { polygonArea } from '../core/geometry';
import { createEmptyProperty, validateProperty } from '../core/layout-validate';
import { applyProposal, proposalToPatch } from '../editor/save';
import { chooseSpawn } from '../import/propose';
import type { PropertyFile } from '../types';

/** The largest whole living room, else bedroom, else any room is where the home starts (the importer's own pick is the largest room, which can be a store). */
export function buildHome(sceneId: string, proposal: unknown, extras: unknown, title: string, subtitle: string, now: Date = new Date()): PropertyFile {
  const p = createEmptyProperty(sceneId);
  const patch = proposalToPatch(proposal, extras);
  applyProposal(p, patch);
  const area = (r: (typeof p.layout.rooms)[number]): number => Math.abs(polygonArea(r.polygon));
  const best = (rooms: typeof p.layout.rooms): (typeof p.layout.rooms)[number] | undefined => [...rooms].sort((a, b) => area(b) - area(a))[0];
  const home = best(p.layout.rooms.filter((x) => x.roomType === 'living' && !x.partial)) ?? best(p.layout.rooms.filter((x) => x.roomType === 'bedroom' && !x.partial)) ?? best(p.layout.rooms);
  // a spawn that is a valid point; the buyer page's smart spawn replaces it
  p.spawn = (home && chooseSpawn({ ...p.layout, rooms: [home], openings: [] }, p.furniture)) ?? patch.spawn ?? chooseSpawn(p.layout, p.furniture) ?? { x: 0, z: 0, yawDeg: 0 };
  p.title = title;
  p.subtitle = subtitle;
  p.updatedAt = now.toISOString();
  return validateProperty(JSON.parse(JSON.stringify(p)));
}
