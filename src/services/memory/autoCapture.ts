import type { CreateMemoryCandidateInput, MemoryKind } from './types';

type CapturePattern = {
  regex: RegExp;
  kind: MemoryKind;
  confidence: number;
  importance?: number;
};

const MIN_BODY_LENGTH = 18;
const MAX_BODY_LENGTH = 700;
const MAX_TITLE_LENGTH = 72;
const ATTACHED_DOCUMENT_MARKER_PATTERN = /\n\s*\nAttached document:/i;

const EXPLICIT_PATTERNS: CapturePattern[] = [
  { regex: /\b(?:please\s+)?remember(?:\s+that|:)?\s+(.+)$/i, kind: 'research_note', confidence: 0.82, importance: 4 },
  { regex: /\b(?:please\s+)?note(?:\s+that|:)?\s+(.+)$/i, kind: 'research_note', confidence: 0.76 },
  { regex: /\b(?:save|keep track of)(?:\s+that|:)?\s+(.+)$/i, kind: 'research_note', confidence: 0.78 },
  { regex: /^(always\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)\b.+)$/i, kind: 'preference', confidence: 0.86, importance: 4 },
  { regex: /^((?:from now on|going forward),?\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)\b.+)$/i, kind: 'preference', confidence: 0.84, importance: 4 },
  { regex: /\bfor (?:this|the) (?:project|case|research|trip|build|hobby),?\s+(.+)$/i, kind: 'research_note', confidence: 0.72 },
];

const PREFERENCE_PATTERNS: CapturePattern[] = [
  { regex: /\b(?:i|we)\s+(prefer|like|use|need|want|usually|always|mostly)\s+(.+)$/i, kind: 'preference', confidence: 0.7 },
  { regex: /\b(?:i am|i'm)\s+(researching|tracking|working on|collecting|building)\s+(.+)$/i, kind: 'research_note', confidence: 0.68 },
];

const SENSITIVE_PATTERNS: RegExp[] = [
  /\b(password|passcode|pin|api key|access token|secret key|private key|recovery phrase)\b/i,
  /\b(ssn|social security|passport|driver'?s license|license number)\b/i,
  /\b(credit card|card number|cvv|routing number|bank account|account number)\b/i,
  /\b(address|phone number|email address)\b/i,
  /\b(diagnosis|medication|medical record|health insurance|prescription)\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b(?:\d[ -]*?){13,19}\b/,
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i,
];

const NEGATED_CAPTURE_PATTERN = /\b(?:do\s+not|don't|dont|never)\s+(?:remember|save|note|keep\s+track\s+of|store|record|capture|persist)\b/i;
const MEMORY_OPT_OUT_PATTERN = /^(?:do\s+not|don't|dont|never)\b.*\b(?:memory|memories|remember(?:ed|ing)?)\b/i;
const ATTACHMENT_RETENTION_OPT_OUT_PATTERN = /\b(?:do\s+not|don't|dont|never)\s+(?:use|include|keep|store|save|remember|record|capture|persist|write)\b.*\b(?:this\s+(?:attachment|document|file)|(?:the\s+)?attached\s+(?:document|file)|attachment)\b/i;
const EXPLICIT_MEMORY_COMMAND_PATTERNS: RegExp[] = [
  /^(?:please\s+)?remember(?::|\s+that)\s*(.*)$/i,
  /^always\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)\b.+$/i,
  /^(?:from now on|going forward),?\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)\b.+$/i,
];
const PREFERENCE_SIGNAL_PATTERN = /\b(?:(?:i|we)\s+(?:prefer|like|want|need|usually|always|mostly)|by default|default to|unless i (?:ask|say otherwise|specify|tell you)|when i ask|if i ask)\b/i;
const NEGATIVE_PREFERENCE_BODY_PATTERN = /^never\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)\b/i;

const TAG_KEYWORDS: Array<[string, RegExp]> = [
  ['tax', /\b(tax|irs|filing|deduction|credit|rebate)\b/i],
  ['law', /\b(law|legal|court|statute|regulation|ordinance|permit|jurisdiction)\b/i],
  ['research', /\b(research|source|citation|study|paper|case)\b/i],
  ['hobby', /\b(hobby|garden|radio|camera|trail|woodworking|recipe|bike|camping)\b/i],
  ['home', /\b(home|house|cabin|property|roof|solar|battery)\b/i],
  ['preference', /\b(?:(?:i|we)\s+(?:prefer|like|want|need|usually|always|mostly)|always\s+(?:ask|avoid|check|cite|default|explain|format|include|keep|plot|prefer|respond|show|summarize|treat|use|verify|write)|default|from now on|going forward|when i ask|if i ask|unless i (?:ask|say otherwise|specify|tell you))\b/i],
];

const JURISDICTION_KEYWORDS: Array<[string, RegExp]> = [
  ['United States', /\b(united states|u\.s\.|us federal|federal|irs)\b/i],
  ['California', /\bcalifornia\b/i],
  ['New York', /\bnew york\b/i],
  ['Texas', /\btexas\b/i],
  ['Florida', /\bflorida\b/i],
  ['Washington', /\bwashington\b/i],
  ['Portugal', /\bportugal\b/i],
  ['European Union', /\b(european union|eu)\b/i],
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function hasInlineMemoryDirective(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  return (
    /^(?:please\s+)?remember(?::|\s+that)\s+\S/i.test(normalized) ||
    /^always\s+\S/i.test(normalized) ||
    /^(?:from now on|going forward),?\s+\S/i.test(normalized)
  );
}

function selectExtractionText(text: string): string {
  const [commandText] = text.split(ATTACHED_DOCUMENT_MARKER_PATTERN);
  if (commandText && commandText !== text && hasInlineMemoryDirective(commandText)) return commandText;
  return text;
}

function trimCandidateBody(text: string): string {
  return normalizeWhitespace(text)
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/^that\s+/i, '')
    .slice(0, MAX_BODY_LENGTH)
    .trim();
}

function firstSentence(text: string): string {
  const match = text.match(/^(.+?[.!?])(?:\s|$)/);
  return (match?.[1] ?? text).trim();
}

function titleFromBody(body: string): string {
  const base = firstSentence(body).replace(/[.!?]+$/g, '').trim();
  const title = base.length > MAX_TITLE_LENGTH ? `${base.slice(0, MAX_TITLE_LENGTH - 3).trim()}...` : base;
  return title ? `${title.charAt(0).toUpperCase()}${title.slice(1)}` : title;
}

function hasQuestionShape(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.endsWith('?') ||
    /^(what|where|why|how|can|could|should|would|is|are|do|does)\b/i.test(trimmed) ||
    /^when\s+(?:is|are|was|were|do|does|did|can|could|should|would|will)\b/i.test(trimmed)
  );
}

function inferTags(text: string): string[] {
  const tags = TAG_KEYWORDS
    .filter(([, regex]) => regex.test(text))
    .map(([tag]) => tag);
  return Array.from(new Set(tags)).slice(0, 8);
}

function inferJurisdiction(text: string): string | undefined {
  return JURISDICTION_KEYWORDS.find(([, regex]) => regex.test(text))?.[0];
}

function inferAsOfDate(text: string): string | undefined {
  const isoDate = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  return isoDate?.[1];
}

function containsSensitiveData(text: string): boolean {
  return SENSITIVE_PATTERNS.some(pattern => pattern.test(text));
}

export function isExplicitMemoryCommand(text: string): boolean {
  const normalized = normalizeWhitespace(text);
  if (NEGATED_CAPTURE_PATTERN.test(normalized)) return false;
  if (MEMORY_OPT_OUT_PATTERN.test(normalized)) return false;
  if (/^(?:always|never|from now on|going forward)\b/i.test(normalized) && hasQuestionShape(normalized)) return false;
  return EXPLICIT_MEMORY_COMMAND_PATTERNS.some(pattern => pattern.test(normalized));
}

function matchPattern(text: string, patterns: CapturePattern[]): { pattern: CapturePattern; body: string } | null {
  for (const pattern of patterns) {
    const match = text.match(pattern.regex);
    const rawBody = match?.[match.length - 1];
    if (!rawBody) continue;
    const body = trimCandidateBody(rawBody);
    if (body.length >= MIN_BODY_LENGTH) return { pattern, body };
  }
  return null;
}

function inferKind(patternKind: MemoryKind, normalized: string, body: string): MemoryKind {
  if (
    patternKind === 'research_note' &&
    (PREFERENCE_SIGNAL_PATTERN.test(`${normalized} ${body}`) || NEGATIVE_PREFERENCE_BODY_PATTERN.test(body))
  ) {
    return 'preference';
  }
  return patternKind;
}

function tagsForKind(kind: MemoryKind, text: string): string[] {
  const tags = inferTags(text);
  if (kind !== 'preference' || tags.includes('preference')) return tags;
  return ['preference', ...tags].slice(0, 8);
}

export function extractMemoryCandidateFromText(
  text: string,
  opts: { projectId?: string } = {},
): CreateMemoryCandidateInput | null {
  const normalized = normalizeWhitespace(selectExtractionText(text));
  if (normalized.length < MIN_BODY_LENGTH) return null;
  if (NEGATED_CAPTURE_PATTERN.test(normalized)) return null;
  if (MEMORY_OPT_OUT_PATTERN.test(normalized)) return null;
  if (ATTACHMENT_RETENTION_OPT_OUT_PATTERN.test(normalized)) return null;
  if (containsSensitiveData(normalized)) return null;

  const explicit = matchPattern(normalized, EXPLICIT_PATTERNS);
  const preference = explicit ? null : matchPattern(normalized, PREFERENCE_PATTERNS);
  const match = explicit ?? preference;
  if (!match) return null;
  if (!explicit && hasQuestionShape(normalized)) return null;

  const body = match.body;
  if (hasQuestionShape(body)) return null;
  const kind = inferKind(match.pattern.kind, normalized, body);

  return {
    scope: opts.projectId ? 'project' : 'global',
    projectId: opts.projectId,
    kind,
    title: titleFromBody(body),
    body,
    tags: tagsForKind(kind, `${normalized} ${body}`),
    confidence: match.pattern.confidence,
    importance: match.pattern.importance ?? 3,
    jurisdiction: inferJurisdiction(body),
    asOfDate: inferAsOfDate(body),
    sourceExcerpt: normalized.slice(0, MAX_BODY_LENGTH),
  };
}
