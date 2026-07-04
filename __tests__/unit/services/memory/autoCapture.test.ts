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
    expect(isExplicitMemoryCommand('remember: never use thin plot lines unless I ask')).toBe(true);
    expect(isExplicitMemoryCommand('remember: never use this document after this chat')).toBe(true);
    expect(isExplicitMemoryCommand('always use linewidth=2 for plots')).toBe(true);
    expect(isExplicitMemoryCommand('from now on, cite the statute before summarizing tax rules')).toBe(true);
    expect(isExplicitMemoryCommand('save this image to Photos')).toBe(false);
    expect(isExplicitMemoryCommand('note the error and explain it')).toBe(false);
    expect(isExplicitMemoryCommand('Please keep track of the garden soil mix.')).toBe(false);
    expect(isExplicitMemoryCommand('Do you remember the plot settings?')).toBe(false);
    expect(isExplicitMemoryCommand('Do not remember that garden note.')).toBe(false);
    expect(isExplicitMemoryCommand('always?')).toBe(false);
    expect(isExplicitMemoryCommand('always fails when plotting?')).toBe(false);
    expect(isExplicitMemoryCommand('Never mind, summarize the article instead.')).toBe(false);
    expect(isExplicitMemoryCommand('Never store this conversation as memory.')).toBe(false);
    expect(isExplicitMemoryCommand('Never use memory for this chat.')).toBe(false);
    expect(isExplicitMemoryCommand('Never include this in memory.')).toBe(false);
    expect(isExplicitMemoryCommand('Never write this to memory.')).toBe(false);
    expect(isExplicitMemoryCommand('Never use this document after this chat.')).toBe(false);
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
      kind: 'preference',
      title: 'When I ask you to plot, use line width 2 unless I say otherwise',
      body: 'when I ask you to plot, use line width 2 unless I say otherwise.',
      tags: expect.arrayContaining(['preference']),
    }));
  });

  it('extracts direct always and from-now-on directives as preferences', () => {
    const alwaysCandidate = extractMemoryCandidateFromText(
      'always use linewidth=2 by default when plotting line charts',
    );
    const fromNowOnCandidate = extractMemoryCandidateFromText(
      'from now on, cite the statute before summarizing tax rules',
    );

    expect(alwaysCandidate).toEqual(expect.objectContaining({
      scope: 'global',
      kind: 'preference',
      title: 'Always use linewidth=2 by default when plotting line charts',
      body: 'always use linewidth=2 by default when plotting line charts',
      tags: expect.arrayContaining(['preference']),
    }));
    expect(fromNowOnCandidate).toEqual(expect.objectContaining({
      scope: 'global',
      kind: 'preference',
      title: 'From now on, cite the statute before summarizing tax rules',
      body: 'from now on, cite the statute before summarizing tax rules',
      tags: expect.arrayContaining(['tax', 'law', 'preference']),
    }));
  });

  it('requires remember wording for negative preference directives', () => {
    const candidate = extractMemoryCandidateFromText(
      'remember: never use thin plot lines unless I ask',
    );

    expect(candidate).toEqual(expect.objectContaining({
      scope: 'global',
      kind: 'preference',
      title: 'Never use thin plot lines unless I ask',
      body: 'never use thin plot lines unless I ask',
      tags: expect.arrayContaining(['preference']),
    }));
    expect(extractMemoryCandidateFromText('Never use this document after this chat.')).toBeNull();
  });

  it('does not save explicit document non-retention directives', () => {
    expect(extractMemoryCandidateFromText(
      'remember: never use this document after this chat',
    )).toBeNull();
    expect(extractMemoryCandidateFromText(
      'remember: never use this document after this chat\n\nAttached document: notes.pdf\nPrivate document text.',
    )).toBeNull();
    expect(extractMemoryCandidateFromText(
      'remember: never use this document outside this chat\n\nAttached document: notes.pdf\nPrivate document text.',
    )).toBeNull();
    expect(extractMemoryCandidateFromText(
      'remember: never use this document in future chats\n\nAttached document: notes.pdf\nPrivate document text.',
    )).toBeNull();
  });

  it('classifies explicit remembered negative preferences without an unless clause', () => {
    const candidate = extractMemoryCandidateFromText('remember: never use semicolons');
    const withAttachment = extractMemoryCandidateFromText(
      'remember: never use semicolons\n\nAttached document: notes.pdf\nPrivate document text.',
    );
    const phraseCandidate = extractMemoryCandidateFromText('remember: never use this phrase');
    const filePathCandidate = extractMemoryCandidateFromText('remember: never write file paths without backticks');

    expect(candidate).toEqual(expect.objectContaining({
      kind: 'preference',
      title: 'Never use semicolons',
      body: 'never use semicolons',
      tags: expect.arrayContaining(['preference']),
    }));
    expect(withAttachment).toEqual(expect.objectContaining({
      kind: 'preference',
      body: 'never use semicolons',
      sourceExcerpt: 'remember: never use semicolons',
    }));
    expect(phraseCandidate).toEqual(expect.objectContaining({
      kind: 'preference',
      body: 'never use this phrase',
    }));
    expect(filePathCandidate).toEqual(expect.objectContaining({
      kind: 'preference',
      body: 'never write file paths without backticks',
    }));
  });

  it('does not misclassify factual remember notes as preferences', () => {
    const failureCandidate = extractMemoryCandidateFromText(
      'Remember that the failure always occurs after reboot.',
    );
    const permitCandidate = extractMemoryCandidateFromText(
      'Remember that permits need two signatures.',
    );

    expect(failureCandidate).toEqual(expect.objectContaining({
      kind: 'research_note',
      body: 'the failure always occurs after reboot.',
    }));
    expect(permitCandidate).toEqual(expect.objectContaining({
      kind: 'research_note',
      body: 'permits need two signatures.',
    }));
    expect(permitCandidate?.tags).not.toContain('preference');
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
    expect(extractMemoryCandidateFromText('Never use memory for this chat.')).toBeNull();
    expect(extractMemoryCandidateFromText('Never include this in memory.')).toBeNull();
  });

  it('skips obvious sensitive personal data', () => {
    expect(extractMemoryCandidateFromText('Remember that my password is correct horse battery staple.')).toBeNull();
    expect(extractMemoryCandidateFromText('Remember that my SSN is 123-45-6789.')).toBeNull();
    expect(extractMemoryCandidateFromText('My home address is 123 Main Street.')).toBeNull();
  });
});
