// Puts label-against-walls findings (label-geometry.ts) onto an import and its analysis: when the importer had no scale of its own the
// fitted one replaces the guess, and verified / conflict statuses fill in where the dimension-line check had nothing to say.
import type { ImportResult } from '../import/types';
import type { LabelGeometry } from './label-geometry';
import type { Analysis } from './text-dims';

/** Adds a warning to the import's extras and the proposal's notes (often the same array: it is added once then). */
export function addNote(result: ImportResult, msg: string, front = false): void {
  const a = result.extras.warnings; const b = (result.proposal.notes ??= []);
  for (const list of a === b ? [a] : [a, b]) { if (front) list.unshift(msg); else list.push(msg); }
}

/** The importer's scale was a guess (no agreeing votes) and the labels-and-walls fit gives a different one. */
export function needsRescale(result: ImportResult, lg: LabelGeometry): boolean {
  if (!lg.ptPerM) return false;
  const sc = result.extras.scale;
  if (sc.agreeing >= 2 && sc.votes.length) return false;
  return !sc.ptPerM || Math.abs(lg.ptPerM / sc.ptPerM - 1) > 0.03;
}

export function applyLabelGeometry(result: ImportResult, analysis: Analysis, lg: LabelGeometry): void {
  // rooms whose traced walls disagreed with the printed size by more than 5% (the importer drew them at the printed size)
  for (const f of result.extras.rooms) {
    if (!f.drawnDims || !f.labelDims) continue;
    analysis.roomStatus.set(f.id, 'conflict');
  }
  if (!lg.fit) return;
  let verified = 0, conflicts = 0;
  for (const [id, st] of lg.status) {
    const have = analysis.roomStatus.get(id);
    if (st === 'conflict') {
      conflicts++;
      analysis.roomStatus.set(id, 'conflict');
      const f = result.extras.rooms.find((r) => r.id === id);
      const note = `Room "${f?.label ?? id}": ${lg.notes.get(id) ?? 'the printed size and the drawn walls disagree'}.`;
      addNote(result, note);
    } else if (st === 'verified' && (!have || have === 'unverified')) { verified++; analysis.roomStatus.set(id, 'verified'); }
  }
  const msg = `Printed room sizes against the drawn walls: ${lg.fit.inliers} of ${lg.fit.total} rooms agree on one scale; ${verified} room${verified === 1 ? '' : 's'} checked${conflicts ? `, ${conflicts} disagree by more than 5%` : ''}.`;
  addNote(result, msg);
}
