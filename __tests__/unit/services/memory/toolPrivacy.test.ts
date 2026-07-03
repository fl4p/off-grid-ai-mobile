import { filterMemoryToolNames, isMemoryToolName } from '../../../../src/services/memory/toolPrivacy';

describe('memory tool privacy helpers', () => {
  it('identifies local memory tools', () => {
    expect(isMemoryToolName('search_memory')).toBe(true);
    expect(isMemoryToolName('save_memory')).toBe(true);
    expect(isMemoryToolName('forget_memory')).toBe(true);
    expect(isMemoryToolName('search_knowledge_base')).toBe(false);
    expect(isMemoryToolName(undefined)).toBe(false);
  });

  it('filters memory tools while preserving non-memory tools', () => {
    expect(filterMemoryToolNames([
      'search_knowledge_base',
      'search_memory',
      'get_current_datetime',
      'save_memory',
      'forget_memory',
      'web_search',
    ])).toEqual([
      'search_knowledge_base',
      'get_current_datetime',
      'web_search',
    ]);
  });
});
