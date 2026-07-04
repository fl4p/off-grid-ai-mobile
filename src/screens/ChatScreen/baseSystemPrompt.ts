import { APP_CONFIG } from '../../constants';

/**
 * The base system prompt to start a generation from. A user/project custom prompt
 * always wins. Otherwise pick the default that matches how the model actually runs:
 * the local default claims to run on-device and keep data private, which is false
 * for a remote endpoint - those requests go to the server the user connected to -
 * so remote generations get an honest variant that makes no local/privacy claim.
 */
export function resolveBaseSystemPrompt(customPrompt: string | undefined | null, isRemote: boolean): string {
  if (customPrompt) return customPrompt;
  return isRemote ? APP_CONFIG.defaultSystemPromptRemote : APP_CONFIG.defaultSystemPrompt;
}
