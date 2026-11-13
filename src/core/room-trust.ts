// Which rooms' sizes were not measured (drawing import fell back to a label, or the room runs off the sheet).
// Shared by the buyer (hide the area) and the editor (tell the broker to check it).

/**
 * Room ids whose size was NOT measured (e.g. a drawing import that fell back to the label's dimensions because the
 * room's walls are not closed on the drawing). Value: a short reason shown to the buyer instead of a confident area.
 */
export type UnverifiedRooms = Record<string, string>;

/** Reads the optional `proposal-extras.json` rooms list: `label-rect` rooms not marked `verified`, and any room marked `verified: false`, are unverified. */
export function unverifiedRoomsFromExtras(extras: unknown): UnverifiedRooms {
  const out: UnverifiedRooms = {};
  const rooms = (extras as { rooms?: unknown } | null)?.rooms;
  if (!Array.isArray(rooms)) return out;
  for (const r of rooms as { id?: unknown; method?: unknown; verified?: unknown; note?: unknown }[]) {
    if (typeof r?.id !== 'string') continue;
    if (r.method === 'label-rect' && r.verified !== true) out[r.id] = 'label size only';
    else if (r.verified === false) out[r.id] = typeof r.note === 'string' && r.note.length > 0 && r.note.length <= 60 ? r.note : 'runs off the drawing';
  }
  return out;
}


// The editor's current scene (set when a scene loads; read by the room list and the plan canvas).
let editorUnverified: UnverifiedRooms = {};
export function setEditorUnverified(u: UnverifiedRooms): void { editorUnverified = u; }
export function editorUnverifiedNote(roomId: string): string | undefined { return editorUnverified[roomId]; }
