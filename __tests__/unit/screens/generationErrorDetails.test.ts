/**
 * Unit tests for generationErrorDetails — the request-detail formatter shown when
 * a generation fails (Issues #9 and #11).
 */
import {
  buildGenerationRequestDebugInfo,
  formatGenerationRequestDetails,
  formatGenerationFailureContent,
  formatGenerationFailureAlert,
} from '../../../src/screens/ChatScreen/generationErrorDetails';

const localModelInfo = {
  isRemote: false,
  model: null,
  modelId: 'qwen-0.5b',
  modelName: 'Qwen 0.5B',
};

const remoteModelInfo = {
  isRemote: true,
  model: null,
  modelId: 'gpt-4o-mini',
  modelName: 'GPT-4o mini',
  serverId: 'osten',
};

const settings = { temperature: 0.7, maxTokens: 512, topP: 0.9, thinkingEnabled: true, contextLength: undefined };

describe('buildGenerationRequestDebugInfo', () => {
  it('assembles prompt, model, tools, project, and settings', () => {
    const info = buildGenerationRequestDebugInfo(
      { activeModelInfo: localModelInfo, activeModel: null, settings },
      { conversationId: 'c1', prompt: 'Hello', tools: ['calculator'], projectId: 'p1', projectName: 'My Project' },
    );
    expect(info).toMatchObject({
      prompt: 'Hello',
      conversationId: 'c1',
      tools: ['calculator'],
      project: { id: 'p1', name: 'My Project' },
      activeModelInfo: localModelInfo,
    });
  });

  it('sets project to null when no projectId is given', () => {
    const info = buildGenerationRequestDebugInfo(
      { activeModelInfo: localModelInfo, settings },
      { conversationId: 'c1', prompt: 'Hi', tools: [] },
    );
    expect(info.project).toBeNull();
  });
});

describe('formatGenerationRequestDetails', () => {
  it('lists the prompt, model id, local provider, and compacted arguments', () => {
    const details = formatGenerationRequestDetails(
      buildGenerationRequestDebugInfo(
        { activeModelInfo: localModelInfo, settings },
        { conversationId: 'c1', prompt: 'What is 2+2?', tools: ['calculator'] },
      ),
    );
    expect(details).toContain('Request:');
    expect(details).toContain('- Prompt: What is 2+2?');
    expect(details).toContain('- Model: Qwen 0.5B (qwen-0.5b)');
    expect(details).toContain('- Provider: Local llama.cpp');
    expect(details).toContain('- Tools: calculator');
    // undefined settings are dropped by compaction
    expect(details).toContain('"temperature": 0.7');
    expect(details).not.toContain('contextLength');
  });

  it('labels a remote provider with its server id and reports no tools', () => {
    const details = formatGenerationRequestDetails(
      buildGenerationRequestDebugInfo(
        { activeModelInfo: remoteModelInfo, settings },
        { conversationId: 'c2', prompt: '', tools: [] },
      ),
    );
    expect(details).toContain('- Provider: Remote (osten)');
    expect(details).toContain('- Tools: none');
    // an empty prompt line is omitted
    expect(details).not.toContain('- Prompt:');
  });
});

describe('formatGenerationFailureContent', () => {
  it('prefixes the error message and includes the request block', () => {
    const content = formatGenerationFailureContent(
      'network timeout',
      buildGenerationRequestDebugInfo(
        { activeModelInfo: remoteModelInfo, settings },
        { conversationId: 'c1', prompt: 'Hi', tools: [] },
      ),
    );
    expect(content.startsWith('Generation failed: network timeout')).toBe(true);
    expect(content).toContain('Request:');
  });
});

describe('formatGenerationFailureAlert', () => {
  it('produces a compact single-object arguments line ending with the message', () => {
    const alert = formatGenerationFailureAlert(
      'boom',
      buildGenerationRequestDebugInfo(
        { activeModelInfo: localModelInfo, settings },
        { conversationId: 'c1', prompt: 'Hi', tools: ['calculator'] },
      ),
    );
    expect(alert).toContain('Model: Qwen 0.5B (qwen-0.5b)');
    expect(alert).toContain('Tools: calculator');
    expect(alert.trim().endsWith('boom')).toBe(true);
  });
});
