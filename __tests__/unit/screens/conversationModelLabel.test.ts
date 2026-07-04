import { resolveConversationModelName } from '../../../src/screens/conversationModelLabel';
import { createConversation, createDownloadedModel } from '../../utils/factories';

describe('resolveConversationModelName', () => {
  it('uses the downloaded model name for local conversations', () => {
    const model = createDownloadedModel({ id: 'model-1', name: 'Local Model' });
    const conversation = createConversation({ modelId: model.id });

    expect(resolveConversationModelName(conversation, [model], {})).toBe('Local Model');
  });

  it('falls back to the stored model id when local metadata is unavailable', () => {
    const conversation = createConversation({ modelId: 'missing-local-model' });

    expect(resolveConversationModelName(conversation, [], {})).toBe('missing-local-model');
  });

  it('uses discovered remote model names and falls back to the remote id', () => {
    const conversation = createConversation({ modelId: 'remote-1', serverId: 'server-1' });

    expect(resolveConversationModelName(conversation, [], {
      'server-1': [{ id: 'remote-1', name: 'Remote Model' } as any],
    })).toBe('Remote Model');
    expect(resolveConversationModelName(conversation, [], {})).toBe('remote-1');
  });
});
