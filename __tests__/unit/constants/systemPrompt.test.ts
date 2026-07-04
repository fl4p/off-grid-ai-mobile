/**
 * The default system prompts must describe the model honestly. The local default
 * may claim to run on-device and keep data private; the remote default must not,
 * because a remote endpoint runs on a server the user connected to.
 */
import { APP_CONFIG } from '../../../src/constants';

describe('default system prompts', () => {
  it('the local default claims on-device operation and privacy', () => {
    expect(APP_CONFIG.defaultSystemPrompt).toContain('running locally on the user');
    expect(APP_CONFIG.defaultSystemPrompt).toContain('prioritizes user privacy');
  });

  it('the remote default makes no local or privacy claim', () => {
    const remote = APP_CONFIG.defaultSystemPromptRemote;
    expect(remote).toBeTruthy();
    expect(remote).not.toContain('running locally on the user');
    expect(remote).not.toContain('prioritizes user privacy');
    expect(remote).not.toMatch(/on your device|on the user's device/i);
  });

  it('the remote default is honest about being a remote endpoint', () => {
    expect(APP_CONFIG.defaultSystemPromptRemote).toContain('remote model endpoint the user connected to');
  });
});
