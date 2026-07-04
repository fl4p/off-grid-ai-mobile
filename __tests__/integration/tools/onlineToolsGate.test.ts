/**
 * Online-tools gate integration test.
 *
 * Verifies the wiring the chat generation path relies on: the app store's
 * privacy-first default, and the gate + OpenAI-schema builder together deciding
 * which tools the model is actually offered. When online tools are off, the
 * network tools (web_search, read_url) must never reach the schema, while the
 * offline-capable run_python still does (its network path is refused later, in
 * the handler).
 */

import { useAppStore } from '../../../src/stores/appStore';
import {
  filterToolsByNetworkAccess,
  getToolsAsOpenAISchema,
} from '../../../src/services/tools/registry';

/** Mirrors generationToolLoop: gate the enabled ids, then build the schema. */
function schemaForModel(enabledToolIds: string[], onlineToolsEnabled: boolean): string[] {
  const gated = filterToolsByNetworkAccess(enabledToolIds, onlineToolsEnabled);
  return getToolsAsOpenAISchema(gated).map(s => s.function.name);
}

describe('online-tools gate (integration)', () => {
  afterEach(() => {
    useAppStore.getState().updateSettings({ onlineToolsEnabled: false });
  });

  it('defaults to off, so a fresh install keeps tools on-device', () => {
    // The whole point of "Off Grid": nothing reaches the network until opt-in.
    expect(useAppStore.getState().settings.onlineToolsEnabled).toBe(false);
  });

  it('hides web_search and read_url from the model when online tools are off', () => {
    useAppStore.getState().updateSettings({ onlineToolsEnabled: false });
    const enabled = useAppStore.getState().settings.enabledTools; // ['web_search','read_url','search_knowledge_base']
    const names = schemaForModel(enabled, useAppStore.getState().settings.onlineToolsEnabled);

    expect(names).not.toContain('web_search');
    expect(names).not.toContain('read_url');
    // A non-network tool the user had enabled survives.
    expect(names).toContain('search_knowledge_base');
  });

  it('exposes network tools once the user turns online tools on', () => {
    useAppStore.getState().updateSettings({ onlineToolsEnabled: true });
    const enabled = useAppStore.getState().settings.enabledTools;
    const names = schemaForModel(enabled, useAppStore.getState().settings.onlineToolsEnabled);

    expect(names).toContain('web_search');
    expect(names).toContain('read_url');
  });

  it('keeps run_python available to the model even when online tools are off', () => {
    useAppStore.getState().updateSettings({ onlineToolsEnabled: false });
    const names = schemaForModel(['run_python', 'web_search'], false);

    expect(names).toContain('run_python');
    expect(names).not.toContain('web_search');
  });
});
