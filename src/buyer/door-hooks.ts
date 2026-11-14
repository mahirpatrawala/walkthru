// A one-way hook so the prompt system (interactions.ts) can offer "Open door" / "Close door" and furnish mode can ask "does this item
// sit in a door's swing?" without importing the door controller (which needs three and the HUD). The controller registers itself
// when the buyer page starts; headless tests never register one, so every answer there is null.
import type { Box, Vec2 } from '../types';

export interface DoorPrompts {
  /** the door nearest the walker within reach, with the words for the pill */
  nearest(p: Vec2): { distM: number; prompt: string } | null;
  /** E / tap on the pill: swing the nearest door. True when there was one. */
  activate(p: Vec2): boolean;
  /** the card sentence for a furniture box that sits in a door's swing ("Blocks the Bedroom door from opening."), or null */
  noteFor(box: Box): string | null;
}

let prompts: DoorPrompts | null = null;

export function setDoorPrompts(p: DoorPrompts | null): void {
  prompts = p;
}

export function nearestDoorPrompt(p: Vec2): { distM: number; prompt: string } | null {
  return prompts ? prompts.nearest(p) : null;
}

export function activateNearestDoor(p: Vec2): boolean {
  return prompts ? prompts.activate(p) : false;
}

/** For a furniture card: a real or placed item that sits in a door's swing. */
export function doorNoteForBox(box: Box): string | null {
  return prompts ? prompts.noteFor(box) : null;
}
