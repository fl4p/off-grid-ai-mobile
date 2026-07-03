import { resolveMemoryProjectId } from '../../../../src/screens/ChatScreen/memoryActions';

describe('ChatScreen memory actions', () => {
  it('uses pending project id before a conversation exists', () => {
    expect(resolveMemoryProjectId(null, 'pending-project')).toBe('pending-project');
  });

  it('uses the active conversation project id when present', () => {
    expect(resolveMemoryProjectId({ projectId: 'conversation-project' }, 'pending-project'))
      .toBe('conversation-project');
  });

  it('does not fall back to stale pending project when active conversation is global', () => {
    expect(resolveMemoryProjectId({ projectId: undefined }, 'stale-project')).toBeUndefined();
  });
});
