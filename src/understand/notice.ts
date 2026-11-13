// C12d. SPEC 17.16 item 10: brokers are told, in plain words, when drawings leave the machine. The editor step (C12e) and the CLI
// show this text whenever vision is on. One place, so the wording cannot drift.
export const VISION_NOTICE_TITLE = 'Drawings are sent to an AI service';
export const VISION_NOTICE = 'To read a picture of a plan, small pieces of the drawing are sent to an AI model provider (Google Gemini, or Anthropic Claude if chosen). '
  + 'Only the plan itself and tight crops of dimension text are sent. Title blocks, notes, names and contact details are blanked out before sending. '
  + 'Nothing is kept by this tool outside the project folder. Turn vision off to keep every drawing on this computer.';
export const NO_VISION_NOTICE = 'Vision is off. Nothing leaves this computer. A picture of a plan cannot be read without it.';
export const visionNotice = (on: boolean): string => (on ? VISION_NOTICE : NO_VISION_NOTICE);
