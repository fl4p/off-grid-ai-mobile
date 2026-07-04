import {
  APP_CONFIG,
  DEFAULT_SETTINGS_SYSTEM_PROMPT,
  DEFAULT_PROJECT_SYSTEM_PROMPT,
} from '../../constants';

// The prompts the app seeds into settings / the built-in project. They claim the
// model runs locally, so on a remote endpoint they must be treated as an app
// default (swappable), not a prompt the user wrote. Matched by exact text so a
// prompt the user genuinely typed is never mistaken for a default.
const APP_DEFAULT_PROMPTS = new Set(
  [APP_CONFIG.defaultSystemPrompt, DEFAULT_SETTINGS_SYSTEM_PROMPT, DEFAULT_PROJECT_SYSTEM_PROMPT]
    .map(p => p?.trim()),
);

/**
 * The base system prompt to start a generation from.
 *
 * A prompt the user actually authored always wins. But the app seeds settings and
 * the built-in project with defaults that say the assistant is "running locally on
 * the user's device" - false on a remote endpoint, where requests go to the server
 * the user connected to. So when the prompt is empty or one of those untouched app
 * defaults, a remote generation gets an honest variant that makes no local/privacy
 * claim. A local generation keeps the seeded default text as-is.
 */
export function resolveBaseSystemPrompt(customPrompt: string | undefined | null, isRemote: boolean): string {
  const trimmed = customPrompt?.trim();
  const isUserAuthored = !!trimmed && !APP_DEFAULT_PROMPTS.has(trimmed);
  if (isUserAuthored) return customPrompt as string;
  if (isRemote) return APP_CONFIG.defaultSystemPromptRemote;
  return customPrompt || APP_CONFIG.defaultSystemPrompt;
}
