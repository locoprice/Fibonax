/**
 * Prompt temperature: how precise or how creative the AI should be.
 *
 * Fibonax never sends a prompt to an AI itself. People copy or insert it into a
 * chat app, and chat apps take no temperature number. So the choice becomes one
 * plain section in the prompt text (assembleBlocks in lib/promptUtils.ts), and
 * the number is stored on the prompt (`prompts.temperature`) so the editor can
 * show the choice again. Null means no choice was made: a prompt saved before
 * this keeps its text exactly as written.
 *
 * The phone rebuilds a prompt's text when it saves an edit, so it carries a
 * copy of this rule (`editTemperatureSection` in app/public/mobile/index.html).
 * src/__tests__/mobileEdit.test.ts holds the two to the same output.
 */

export interface TemperaturePreset {
  /** The number stored and shown. */
  value: number;
  /** The step's name on the control. */
  label: string;
  /** What the step is good for, in everyday words. */
  bestFor: string;
  /** The words the AI reads. */
  instruction: string;
}

const PRECISE: TemperaturePreset = {
  value: 0.2,
  label: 'Precise',
  bestFor: 'Facts, data and code',
  instruction:
    'Answer as if your temperature were set to 0.2: precise and factual. Stick to what you know and say so when you are unsure.',
};

const BALANCED: TemperaturePreset = {
  value: 0.5,
  label: 'Balanced',
  bestFor: 'Writing and everyday answers',
  instruction: 'Answer as if your temperature were set to 0.5: balanced, clear and natural.',
};

const CREATIVE: TemperaturePreset = {
  value: 0.9,
  label: 'Creative',
  bestFor: 'Brainstorming and stories',
  instruction:
    'Answer as if your temperature were set to 0.9: creative and varied. Offer original ideas and unexpected angles.',
};

/** The three steps, from precise to creative. */
export const TEMPERATURE_PRESETS: readonly TemperaturePreset[] = [PRECISE, BALANCED, CREATIVE];

/** What a new prompt starts on. */
export const DEFAULT_TEMPERATURE = 0.5;

/**
 * The step a stored number belongs to: up to 0.3 Precise, up to 0.7 Balanced,
 * above that Creative. Null, or anything that is not a number from 0 to 2,
 * has no step.
 */
export function temperaturePreset(value: number | null | undefined): TemperaturePreset | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 2) return null;
  if (value <= 0.3) return PRECISE;
  if (value <= 0.7) return BALANCED;
  return CREATIVE;
}

/** The section the prompt text carries for this choice, or '' when none was made. */
export function temperatureSection(value: number | null | undefined): string {
  const preset = temperaturePreset(value);
  return preset ? `## Answer style\n${preset.instruction}` : '';
}
