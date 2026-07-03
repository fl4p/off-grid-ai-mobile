import type { CacheType, DownloadedModel, RemoteModel } from '../../types';

type ActiveModelInfo = {
  isRemote: boolean;
  model: DownloadedModel | RemoteModel | null;
  modelId: string | null;
  modelName: string;
  serverId?: string;
};

type GenerationSettings = {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  repeatPenalty?: number;
  contextLength?: number;
  nThreads?: number;
  nBatch?: number;
  cacheType?: CacheType;
  thinkingEnabled?: boolean;
  liteRTBackend?: string;
  liteRTTemperature?: number;
  liteRTTopP?: number;
  liteRTMaxTokens?: number;
};

export type GenerationRequestDebugInfo = {
  prompt?: string;
  activeModelInfo?: ActiveModelInfo;
  activeModel?: DownloadedModel | null;
  conversationId?: string;
  project?: { id?: string; name?: string } | null;
  tools?: string[];
  settings: GenerationSettings;
};

export function buildGenerationRequestDebugInfo(
  deps: { activeModelInfo?: ActiveModelInfo; activeModel?: DownloadedModel | null; settings: GenerationSettings },
  opts: { conversationId: string; prompt: string; tools: string[]; projectId?: string; projectName?: string },
): GenerationRequestDebugInfo {
  return {
    prompt: opts.prompt,
    activeModelInfo: deps.activeModelInfo,
    activeModel: deps.activeModel || null,
    conversationId: opts.conversationId,
    project: opts.projectId ? { id: opts.projectId, name: opts.projectName } : null,
    tools: opts.tools,
    settings: deps.settings,
  };
}

function compactObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined && v !== null));
}

function buildArgs(settings: GenerationSettings): Record<string, unknown> {
  return compactObject({
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    topP: settings.topP,
    repeatPenalty: settings.repeatPenalty,
    contextLength: settings.contextLength,
    nThreads: settings.nThreads,
    nBatch: settings.nBatch,
    cacheType: settings.cacheType,
    thinkingEnabled: settings.thinkingEnabled,
    liteRTBackend: settings.liteRTBackend,
    liteRTTemperature: settings.liteRTTemperature,
    liteRTTopP: settings.liteRTTopP,
    liteRTMaxTokens: settings.liteRTMaxTokens,
  });
}

function providerLabel(info?: ActiveModelInfo, activeModel?: DownloadedModel | null): string {
  if (info?.isRemote) return `Remote${info.serverId ? ` (${info.serverId})` : ''}`;
  return activeModel?.engine === 'litert' ? 'Local LiteRT' : 'Local llama.cpp';
}

/** Just the request block (Prompt/Model/Provider/Tools/Arguments) — used as the collapsible detail under an error message (Issue #11). */
export function formatGenerationRequestDetails(request: GenerationRequestDebugInfo): string {
  const args = buildArgs(request.settings);
  const lines = [
    'Request:',
    request.prompt?.trim() ? `- Prompt: ${request.prompt.trim()}` : undefined,
    `- Model: ${request.activeModelInfo?.modelName || request.activeModel?.name || 'Unknown'}${request.activeModelInfo?.modelId ? ` (${request.activeModelInfo.modelId})` : ''}`,
    `- Provider: ${providerLabel(request.activeModelInfo, request.activeModel)}`,
    request.conversationId ? `- Conversation: ${request.conversationId}` : undefined,
    request.project?.id ? `- Project: ${request.project.name || request.project.id}` : undefined,
    request.tools?.length ? `- Tools: ${request.tools.join(', ')}` : '- Tools: none',
    '- Arguments:',
    '```json',
    JSON.stringify(args, null, 2),
    '```',
  ];
  return lines.filter(Boolean).join('\n');
}

export function formatGenerationFailureContent(message: string, request: GenerationRequestDebugInfo): string {
  return [`Generation failed: ${message}`, '', formatGenerationRequestDetails(request)].join('\n');
}

/** The inline chat message shown when generation fails (Issues #9/#11). isSystemInfo
 *  keeps it out of the LLM context; isError drives the error rendering; errorDetails
 *  holds the collapsible request block. */
export function buildGenerationErrorMessage(message: string, request: GenerationRequestDebugInfo) {
  return {
    role: 'assistant' as const,
    content: `Generation failed: ${message}`,
    isSystemInfo: true,
    isError: true,
    errorDetails: formatGenerationRequestDetails(request),
  };
}

export function formatGenerationFailureAlert(message: string, request: GenerationRequestDebugInfo): string {
  const args = buildArgs(request.settings);
  const prompt = request.prompt?.trim();
  return [
    prompt ? `Prompt: ${prompt}` : undefined,
    `Model: ${request.activeModelInfo?.modelName || request.activeModel?.name || 'Unknown'}${request.activeModelInfo?.modelId ? ` (${request.activeModelInfo.modelId})` : ''}`,
    `Provider: ${providerLabel(request.activeModelInfo, request.activeModel)}`,
    request.tools?.length ? `Tools: ${request.tools.join(', ')}` : 'Tools: none',
    `Arguments: ${JSON.stringify(args)}`,
    '',
    message,
  ].filter(Boolean).join('\n');
}
