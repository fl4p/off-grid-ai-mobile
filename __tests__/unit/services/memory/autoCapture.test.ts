import {
  extractMemoryCandidateFromText,
  isExplicitMemoryCommand,
} from '../../../../src/services/memory/autoCapture';

describe('memory auto-capture extraction', () => {
  it('extracts explicit remember cues as project candidates', () => {
    const candidate = extractMemoryCandidateFromText(
      'Remember that the county solar permit office closes at 3 PM on Fridays.',
      { projectId: 'proj-solar' },
    );

    expect(candidate).toEqual(expect.objectContaining({
      scope: 'project',
      projectId: 'proj-solar',
      kind: 'research_note',
      title: 'The county solar permit office closes at 3 PM on Fridays',
      body: 'the county solar permit office closes at 3 PM on Fridays.',
      tags: expect.arrayContaining(['law', 'home']),
    }));
  });

  it('detects explicit memory commands without matching ordinary questions', () => {
    expect(isExplicitMemoryCommand('remember: use linewidth=2 for plots')).toBe(true);
    expect(isExplicitMemoryCommand('remember:')).toBe(true);
    expect(isExplicitMemoryCommand('remember that garden soil mix is 50% compost')).toBe(true);
    expect(isExplicitMemoryCommand('save this image to Photos')).toBe(false);
    expect(isExplicitMemoryCommand('note the error and explain it')).toBe(false);
    expect(isExplicitMemoryCommand('Please keep track of the garden soil mix.')).toBe(false);
    expect(isExplicitMemoryCommand('Do you remember the plot settings?')).toBe(false);
    expect(isExplicitMemoryCommand('Do not remember that garden note.')).toBe(false);
  });

  it('extracts stable user preferences without an explicit remember command', () => {
    const candidate = extractMemoryCandidateFromText('I prefer concise summaries with links to primary tax sources.');

    expect(candidate).toEqual(expect.objectContaining({
      scope: 'global',
      kind: 'preference',
      title: 'Concise summaries with links to primary tax sources',
      body: 'concise summaries with links to primary tax sources.',
      tags: expect.arrayContaining(['tax', 'preference']),
    }));
  });

  it('extracts explicit plot defaults for automatic saving', () => {
    const candidate = extractMemoryCandidateFromText(
      'Remember: when I ask you to plot, use line width 2 unless I say otherwise.',
    );

    expect(candidate).toEqual(expect.objectContaining({
      scope: 'global',
      title: 'When I ask you to plot, use line width 2 unless I say otherwise',
      body: 'when I ask you to plot, use line width 2 unless I say otherwise.',
    }));
  });

  it('adds jurisdiction and as-of date hints when available', () => {
    const candidate = extractMemoryCandidateFromText(
      'Note that the IRS EV credit note is current as of 2026-07-03 for federal filing research.',
    );

    expect(candidate).toEqual(expect.objectContaining({
      jurisdiction: 'United States',
      asOfDate: '2026-07-03',
      tags: expect.arrayContaining(['tax', 'research']),
    }));
  });

  it('skips ordinary questions and short statements', () => {
    expect(extractMemoryCandidateFromText('What is the tax deadline?')).toBeNull();
    expect(extractMemoryCandidateFromText('Remember: when is the tax filing deadline?')).toBeNull();
    expect(extractMemoryCandidateFromText('Remember this.')).toBeNull();
  });

  it('skips negated remember and save instructions', () => {
    expect(extractMemoryCandidateFromText(
      'Do not remember that the cabin permit office closes at 3 PM on Fridays.',
    )).toBeNull();
    expect(extractMemoryCandidateFromText(
      'Please don\'t save that I prefer long summaries for this project.',
    )).toBeNull();
  });

  it('skips obvious sensitive personal data', () => {
    expect(extractMemoryCandidateFromText('Remember that my password is correct horse battery staple.')).toBeNull();
    expect(extractMemoryCandidateFromText('Remember that my SSN is 123-45-6789.')).toBeNull();
    expect(extractMemoryCandidateFromText('My home address is 123 Main Street.')).toBeNull();
  });
});
