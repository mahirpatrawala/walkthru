// What a walker does at a catalogue piece that has a rule of its own (src/core/pieces.ts): the prompt on the pill, and which pose. Pieces of
// the original table (and drawn items) have no rule and keep the kind's action (src/buyer/store.ts `actionFor`).
import { chairPose, liePose, machineSeatPose, seatPose, swingSeatPose } from '../core/poses';
import { pieceRule } from '../core/pieces';
import type { FurnitureItem, LiePose, SeatPose, Vec2 } from '../types';

export interface PieceAction { action: 'lie' | 'sit' | 'stand' | 'dims' | 'walk'; prompt: string; upPrompt: string }

const DEFAULT_PROMPT = { lie: 'Lie on the bed', sit: 'Sit down', stand: 'Stand at the counter', dims: 'See dimensions', walk: 'Step on' } as const;

/** The action of a piece with a rule, or null. A swing, a chair and a sofa all `sit`: the pose differs, not the mode. */
export function pieceAction(item: Pick<FurnitureItem, 'catalogId'>): PieceAction | null {
  const rule = pieceRule(item.catalogId);
  if (!rule) return null;
  const action = rule.pose === 'lie' ? 'lie' : rule.pose === 'stand' ? 'stand' : rule.pose === 'dims' ? 'dims' : rule.pose === 'walk-on' ? 'walk' : 'sit';
  return { action, prompt: rule.prompt ?? DEFAULT_PROMPT[action], upPrompt: rule.upPrompt ?? (action === 'stand' ? 'Step back' : action === 'walk' ? 'Step off' : 'Get up') };
}

/** The seat pose of a piece with a rule (null: use the sofa's). */
export function pieceSeatPose(item: FurnitureItem, heightM: number, approach: Vec2): SeatPose | null {
  const rule = pieceRule(item.catalogId);
  if (!rule) return null;
  if (rule.pose === 'swing') return swingSeatPose(item, heightM, approach);
  if (rule.pose === 'chair' && rule.seat) return machineSeatPose(item.box, rule.seat, item.surfaceHeightM, heightM);
  if (rule.pose === 'chair') return chairPose(item.box, item.surfaceHeightM, heightM);
  return seatPose(item, heightM, approach);
}

/** The lying pose of a piece with a rule (the same as a bed's: along its length, on its mattress). */
export function pieceLiePose(item: FurnitureItem, heightM: number, approach: Vec2): LiePose {
  return liePose(item, heightM, approach);
}
