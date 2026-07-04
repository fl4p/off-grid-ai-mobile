import {
  buildMemoryCandidateApprovalInput,
  buildMemoryInput,
  parseMemoryTags,
} from '../../../../src/screens/MemoryEditorScreen.form';

describe('MemoryEditorScreen form helpers', () => {
  it('parses comma and newline separated tags', () => {
    expect(parseMemoryTags('tax, solar\nfederal, , rebate')).toEqual([
      'tax',
      'solar',
      'federal',
      'rebate',
    ]);
  });

  it('builds project-scoped memory input with metadata', () => {
    expect(buildMemoryInput({
      projectId: 'proj-tax',
      kind: 'source_backed_fact',
      title: '  Solar credit rule  ',
      body: ' Verify against current IRS guidance. ',
      tagsText: 'tax, solar',
      jurisdiction: ' United States ',
      asOfDate: ' 2026-07-03 ',
    })).toEqual({
      projectId: 'proj-tax',
      scope: 'project',
      kind: 'source_backed_fact',
      title: 'Solar credit rule',
      body: 'Verify against current IRS guidance.',
      tags: ['tax', 'solar'],
      jurisdiction: 'United States',
      asOfDate: '2026-07-03',
      sourceType: 'manual',
    });
  });

  it('builds global memory input without empty optional metadata', () => {
    expect(buildMemoryInput({
      kind: 'research_note',
      title: 'Trail camera',
      body: 'Batteries are rechargeable AA cells.',
      jurisdiction: ' ',
      asOfDate: '',
    })).toEqual({
      projectId: undefined,
      scope: 'global',
      kind: 'research_note',
      title: 'Trail camera',
      body: 'Batteries are rechargeable AA cells.',
      tags: [],
      jurisdiction: undefined,
      asOfDate: undefined,
      sourceType: 'manual',
    });
  });

  it('builds candidate approval edits without manual source metadata', () => {
    expect(buildMemoryCandidateApprovalInput({
      kind: 'preference',
      title: '  Concise answers  ',
      body: ' Prefer short summaries. ',
      tagsText: 'style, concise',
      jurisdiction: ' ',
      asOfDate: ' 2026-07-03 ',
    })).toEqual({
      kind: 'preference',
      title: 'Concise answers',
      body: 'Prefer short summaries.',
      tags: ['style', 'concise'],
      jurisdiction: undefined,
      asOfDate: '2026-07-03',
    });
  });

  it('requires title and body', () => {
    expect(() => buildMemoryInput({
      kind: 'research_note',
      title: '',
      body: 'Body',
    })).toThrow('Title is required');
    expect(() => buildMemoryInput({
      kind: 'research_note',
      title: 'Title',
      body: ' ',
    })).toThrow('Memory text is required');
  });
});
