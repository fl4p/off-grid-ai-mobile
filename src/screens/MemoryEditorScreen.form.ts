import type { ApproveMemoryCandidateInput, CreateMemoryInput, MemoryKind } from '../services/memory';

export const MEMORY_KIND_OPTIONS: Array<{ kind: MemoryKind; label: string }> = [
  { kind: 'research_note', label: 'Research Note' },
  { kind: 'source_backed_fact', label: 'Source-backed Fact' },
  { kind: 'decision', label: 'Decision' },
  { kind: 'open_question', label: 'Open Question' },
  { kind: 'procedure', label: 'Procedure' },
  { kind: 'preference', label: 'Preference' },
  { kind: 'personal_context', label: 'Personal Context' },
];

export function parseMemoryTags(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map(tag => tag.trim())
    .filter(Boolean)
    .slice(0, 12);
}

export function buildMemoryInput(params: {
  projectId?: string;
  kind: MemoryKind;
  title: string;
  body: string;
  tagsText?: string;
  jurisdiction?: string;
  asOfDate?: string;
}): CreateMemoryInput {
  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) throw new Error('Title is required');
  if (!body) throw new Error('Memory text is required');

  const jurisdiction = params.jurisdiction?.trim();
  const asOfDate = params.asOfDate?.trim();
  return {
    projectId: params.projectId,
    scope: params.projectId ? 'project' : 'global',
    kind: params.kind,
    title,
    body,
    tags: parseMemoryTags(params.tagsText ?? ''),
    jurisdiction: jurisdiction || undefined,
    asOfDate: asOfDate || undefined,
    sourceType: 'manual',
  };
}

export function buildMemoryCandidateApprovalInput(params: {
  kind: MemoryKind;
  title: string;
  body: string;
  tagsText?: string;
  jurisdiction?: string;
  asOfDate?: string;
}): ApproveMemoryCandidateInput {
  const title = params.title.trim();
  const body = params.body.trim();
  if (!title) throw new Error('Title is required');
  if (!body) throw new Error('Memory text is required');

  return {
    kind: params.kind,
    title,
    body,
    tags: parseMemoryTags(params.tagsText ?? ''),
    jurisdiction: params.jurisdiction?.trim() || undefined,
    asOfDate: params.asOfDate?.trim() || undefined,
  };
}
