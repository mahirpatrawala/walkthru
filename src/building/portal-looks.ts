// How a space's portal doors look and what the prompt in front of each says. Pure.
import type { BuildingFile, DoorLook, Portal, Space } from './types';
import type { DoorStyle } from './space-host';

/** The look a portal asks for, or its kind's own. */
export function lookOf(p: Portal): DoorLook {
  if (p.kind === 'lift') return 'lift';
  if (p.kind === 'stairs') return 'stairs';
  if (p.kind === 'outside') return p.look ?? 'glass';
  return p.look ?? 'plain';
}

/** Opening id -> style, for the doors of one space. A number plate faces the corridor: the room's side in the corridor, the other side from inside a flat. */
export function doorLooksFor(space: Space): Map<string, DoorStyle> {
  const out = new Map<string, DoorStyle>();
  for (const p of space.portals) {
    const kind = lookOf(p);
    if (kind === 'plain' && p.kind !== 'door') continue;
    const style: DoorStyle = { kind };
    if (kind === 'main' && p.kind === 'door' && p.plate) { style.text = p.plate; style.plateSide = space.kind === 'home' ? -1 : 1; }
    if (kind === 'stairs') { style.text = 'STAIRS'; style.plateSide = 1; }
    out.set(p.opening, style);
  }
  return out;
}

/** The words on the prompt pill in front of a portal. */
export function portalPrompt(p: Portal): string {
  switch (p.kind) {
    case 'door': return p.prompt ?? `Go to ${p.label}`;
    case 'lift': return 'Call lift';
    case 'stairs': return 'Stairs (not walkable yet)';
    case 'outside': return p.prompt ?? `To ${p.label.toLowerCase()}`;
  }
}

/** The words on the signboard over a portal door, or null for no board: a home has none inside it, the stairs door carries its own sign.
 * Over a flat's door the board gives the flat and its type ("Flat 204 · 2 BHK"), read from the building file; a numbered door whose type is unknown keeps only its plate. */
export function signText(p: Portal, space: Space, b?: BuildingFile): string | null {
  if (space.kind === 'home') return null;
  if (p.kind === 'lift') return 'Lift';
  if (p.kind === 'stairs') return null;
  if (p.kind === 'outside') return 'Exit';
  const far = b?.levels.flatMap((l) => l.spaces).find((q) => q.id === p.to.space);
  const type = far?.type ? b?.flatTypes[far.type]?.name : undefined;
  if (type) return `${p.label} · ${type}`;
  if (p.plate) return null;
  const t = p.label.replace(/^the\s+/i, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : null;
}
