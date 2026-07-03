 import { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { AlertState, showAlert, hideAlert } from '../../components';
import { APP_CONFIG } from '../../constants';
import {
  llmService, intentClassifier, generationService, imageGenerationService,
  onnxImageGeneratorService, ImageGenerationState, buildPromptWithToolNote,
  contextCompactionService,
} from '../../services';
import { liteRTService } from '../../services/litert';
import { ensureDefaultClassifier } from '../../services/classifierProvisioning';
import { abortPreload } from '../../services/modelPreloader';
import { useChatStore, useProjectStore } from '../../stores';
import { callHook, HOOKS } from '../../bootstrap/hookRegistry';
import { Message, MediaAttachment, Project, DownloadedModel, RemoteModel, CacheType } from '../../types';
import logger from '../../utils/logger';
import { injectChatContext } from './contextInjection';
import { isRemoteGeneration, maybeCaptureMemoryCandidate } from './generationMemoryCapture';
import { buildMessagesForContext, buildMessagesWithCompactionPrefix } from './generationContextMessages';
import { generateWithCompactionRetry } from './generationCompactionRetry';
type SetState<T> = Dispatch<SetStateAction<T>>;
const MEMORY_TOOL_IDS = ['search_memory', 'save_memory', 'forget_memory'];

export type GenerationDeps = {
  activeModelId: string | null;
  activeModel: DownloadedModel | null | undefined;
  activeModelInfo?: { isRemote: boolean; model: DownloadedModel | RemoteModel | null; modelId: string | null; modelName: string; serverId?: string };
  hasActiveModel?: boolean;
  hasTextModel?: boolean;
  /** Same tool gate the UI shows; when false the Tools badge reads "N/A" and the picker is locked, so generation must not inject tools either. */
  supportsToolCalling?: boolean;
  activeConversationId: string | null | undefined;
  activeConversation: any;
  activeProject: any;
  activeImageModel: any;
  imageModelLoaded: boolean;
  isStreaming: boolean;
  isGeneratingImage: boolean;
  imageGenState: ImageGenerationState;
  settings: {
    showGenerationDetails: boolean;
    imageGenerationMode: string;
    autoDetectMethod: string;
    classifierModelId?: string | null;
    systemPrompt?: string;
    imageSteps?: number;
    imageGuidanceScale?: number;
    enabledTools?: string[];
    cacheType?: CacheType;
    thinkingEnabled?: boolean;
    memoryAutoCaptureEnabled?: boolean;
  };
  downloadedModels: DownloadedModel[];
  setAlertState: SetState<AlertState>;
  setIsClassifying: SetState<boolean>;
  setAppImageGenerationStatus: (v: string | null) => void;
  setAppIsGeneratingImage: (v: boolean) => void;
  addMessage: (convId: string, msg: any) => Message;
  clearStreamingMessage: () => void;
  deleteConversation: (convId: string) => void;
  setActiveConversation: (convId: string | null) => void;
  removeImagesByConversationId: (convId: string) => string[];
  generatingForConversationRef: MutableRefObject<string | null>;
  navigation: any;
  setShowSettingsPanel?: SetState<boolean>;
  ensureModelLoaded: () => Promise<void>;
  /** Loads the last-selected text model for a chat request that has none; opens
   *  the model selector and returns false when no text model was ever chosen. */
  ensureTextModelForChat: () => Promise<boolean>;
  /** Stash a message to replay after the user picks a text model. */
  setPendingMessage?: (text: string, attachments?: MediaAttachment[]) => void;
  createConversation: (modelId: string, title?: string, projectId?: string, serverId?: string) => string;
  pendingProjectId?: string;
};
function appendAttachmentText(text: string, attachments?: MediaAttachment[]): string {
  if (!attachments) return text;
  return attachments.filter(a => a.type === 'document' && a.textContent)
    .reduce((acc, doc) => `${acc}\n\n---\n📄 **Attached Document: ${doc.fileName || 'document'}**\n\`\`\`\n${doc.textContent}\n\`\`\`\n---`, text);
}
export async function shouldRouteToImageGenerationFn(
  deps: Pick<GenerationDeps, 'isGeneratingImage' | 'settings' | 'imageModelLoaded' | 'downloadedModels' | 'setIsClassifying' | 'setAppImageGenerationStatus' | 'setAppIsGeneratingImage' | 'hasTextModel'>,
  text: string,
  forceImageMode?: boolean,
): Promise<boolean> {
  if (deps.isGeneratingImage) return false;
  if (deps.settings.imageGenerationMode === 'manual') return forceImageMode === true;
  if (forceImageMode) return true;
  if (!deps.imageModelLoaded) return false;
  // No text model (image-only): SMOL classifier decides text vs image, else heuristics; chat returns false.
  if (deps.hasTextModel === false) {
    const classifierModel = deps.settings.classifierModelId
      ? deps.downloadedModels.find(m => m.id === deps.settings.classifierModelId)
      : null;
    if (!classifierModel) {
      // No classifier yet: provision SmolLM2 in the background for next time,
      // and use fast heuristics for this turn.
      ensureDefaultClassifier().catch(() => {});
      const intent = await intentClassifier.classifyIntent(text, { useLLM: false });
      return intent === 'image';
    }
    deps.setIsClassifying(true);
    try {
      const intent = await intentClassifier.classifyIntent(text, {
        useLLM: true,
        classifierModel,
        currentModelPath: llmService.getLoadedModelPath(),
      });
      return intent === 'image';
    } finally {
      deps.setIsClassifying(false);
    }
  }
  try {
    const useLLM = deps.settings.autoDetectMethod === 'llm';
    const classifierModel = deps.settings.classifierModelId
      ? deps.downloadedModels.find(m => m.id === deps.settings.classifierModelId)
      : null;
    if (useLLM) deps.setIsClassifying(true);
    const intent = await intentClassifier.classifyIntent(text, {
      useLLM,
      classifierModel,
      currentModelPath: llmService.getLoadedModelPath(),
      onStatusChange: useLLM ? deps.setAppImageGenerationStatus : undefined,
    });
    deps.setIsClassifying(false);
    if (intent !== 'image' && useLLM) {
      deps.setAppImageGenerationStatus(null);
      deps.setAppIsGeneratingImage(false);
    }
    return intent === 'image';
  } catch {
    deps.setIsClassifying(false);
    deps.setAppImageGenerationStatus(null);
    deps.setAppIsGeneratingImage(false);
    return false;
  }
}
export type ImageGenCall = {
  prompt: string;
  conversationId: string;
  skipUserMessage?: boolean;
  attachments?: MediaAttachment[]; // kept on the user message (e.g. a voice note)
};
export async function handleImageGenerationFn(
  deps: Pick<GenerationDeps, 'activeImageModel' | 'settings' | 'imageGenState' | 'setAlertState' | 'addMessage'>,
  call: ImageGenCall,
): Promise<void> {
  const { prompt, conversationId, skipUserMessage = false, attachments } = call;
  if (!deps.activeImageModel) { deps.setAlertState(showAlert('Error', 'No image model loaded.')); return; }
  // Keep attachments (e.g. a voice note) so the user message renders as a voice note.
  if (!skipUserMessage) { deps.addMessage(conversationId, { role: 'user', content: prompt, attachments }); }
  const result = await imageGenerationService.generateImage({
    prompt, conversationId,
    steps: deps.settings.imageSteps || 8,
    guidanceScale: deps.settings.imageGuidanceScale || 2,
    previewInterval: 2,
  });
  if (!result && deps.imageGenState.error && !deps.imageGenState.error.includes('cancelled')) {
    deps.setAlertState(showAlert('Error', `Image generation failed: ${deps.imageGenState.error}`));
  }
  // Image gen finishes outside generationService — release any queued messages.
  generationService.drainQueue();
}
export type StartGenerationCall = { setDebugInfo: SetState<any>; targetConversationId: string; messageText: string };
async function ensureModelReady(deps: GenerationDeps): Promise<boolean> {
  if (deps.activeModelInfo?.isRemote) return true;
  if (deps.activeModel?.engine === 'litert') {
    if (liteRTService.isModelLoaded()) return true;
    await deps.ensureModelLoaded();
    return liteRTService.isModelLoaded();
  }
  const loadedPath = llmService.getLoadedModelPath();
  if (loadedPath && loadedPath === deps.activeModel!.filePath) return true;
  await deps.ensureModelLoaded();
  return llmService.isModelLoaded() && llmService.getLoadedModelPath() === deps.activeModel!.filePath;
}
async function prepareContext(setDebugInfo: SetState<any>, systemPrompt: string, messages: Message[]): Promise<void> {
  try {
    const contextDebug = await llmService.getContextDebugInfo(messages);
    setDebugInfo({ systemPrompt, ...contextDebug });
    if (contextDebug.truncatedCount > 0 || contextDebug.contextUsagePercent > 70) {
      await llmService.clearKVCache(false).catch(() => { });
    }
  } catch { /* ignore */ }
}
/** Gemma 4 E2B/E4B need <|think|> prepended to activate thinking mode — both llama.cpp and LiteRT. */
const applyGemma4ThinkToken = (prompt: string, isRemote: boolean, opts?: { isLiteRT?: boolean; thinkingEnabled?: boolean }): string => {
  const { isLiteRT = false, thinkingEnabled = false } = opts ?? {};
  const liteRTWantsThink = !isRemote && isLiteRT && thinkingEnabled;
  const llamaWantsThink = !isRemote && llmService.isGemma4Model() && llmService.isThinkingEnabled();
  return (liteRTWantsThink || llamaWantsThink) ? `<|think|>\n${prompt}` : prompt;
};
function resolveToolsAndPrompt(deps: GenerationDeps, conversation: any, _messageText: string): { enabledTools: string[]; rawPrompt: string; isLiteRT: boolean } {
  const project = conversation?.projectId ? useProjectStore.getState().getProject(conversation.projectId) : null;
  const isLiteRT = deps.activeModel?.engine === 'litert' && liteRTService.isModelLoaded();
  const isRemote = isRemoteGeneration({ activeModelInfo: deps.activeModelInfo });
  // Honour the UI gate: "N/A" (supportsToolCalling === false) means the picker is unreachable, so don't inject tools the user can't disable.
  const canUseTools = deps.supportsToolCalling !== false && (llmService.supportsToolCalling() || isRemote || isLiteRT);

  let enabledTools = canUseTools ? (deps.settings.enabledTools || []) : [];
  if (isRemote) {
    enabledTools = enabledTools.filter(toolId => !MEMORY_TOOL_IDS.includes(toolId));
  }

  // Auto-add search_knowledge_base for project chats even if not in user's enabled list
  if (conversation?.projectId && !enabledTools.includes('search_knowledge_base')) {
    enabledTools = [...enabledTools, 'search_knowledge_base'];
  }
  if (canUseTools && !isRemote && conversation?.projectId && !enabledTools.includes('search_memory')) {
    enabledTools = [...enabledTools, 'search_memory'];
  }

  const rawPrompt = project?.systemPrompt || deps.settings.systemPrompt || APP_CONFIG.defaultSystemPrompt;
  return { enabledTools, rawPrompt, isLiteRT };
}
export async function startGenerationFn(deps: GenerationDeps, call: StartGenerationCall): Promise<void> {
  const { setDebugInfo, targetConversationId, messageText } = call;
  if (!deps.hasActiveModel) return;
  // Pure text executor. Image-vs-text routing happens upstream in
  // dispatchGenerationFn — this function only ever generates text.
  deps.generatingForConversationRef.current = targetConversationId;
  // For remote models, skip local model loading
  if (!deps.activeModelInfo?.isRemote && deps.activeModel) {
    if (!(await ensureModelReady(deps))) {
      deps.setAlertState(showAlert('Error', 'Failed to load model. Please try again.'));
      deps.generatingForConversationRef.current = null;
      return;
    }
  }
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const { enabledTools, rawPrompt, isLiteRT } = resolveToolsAndPrompt(deps, conversation, messageText);
  const isRemote = isRemoteGeneration({ activeModelInfo: deps.activeModelInfo });
  let basePrompt = await injectChatContext({
    projectId: conversation?.projectId,
    query: messageText,
    prompt: rawPrompt,
    includeMemory: !isRemote,
  });

  // In voice/audio mode the pro audio feature augments the prompt for spoken
  // output. No-op (returns undefined) in free builds.
  basePrompt = callHook<string>(HOOKS.audioAugmentPrompt, basePrompt) ?? basePrompt;

  const activeTools = enabledTools;
  // LiteRT passes tools natively via ConversationConfig — text hint would double-inject.
  // llama.cpp uses text hint only when it lacks native Jinja tool calling support.
  const useTextHint = !isRemote && !isLiteRT && activeTools.length > 0 && !llmService.supportsToolCalling();

  // buildPromptWithToolNote adds only the built-in-tools line; MCP/extension hints
  // come solely from augmentSystemPromptForTools in the tool loop (no double-inject).
  const systemPrompt = applyGemma4ThinkToken(
    buildPromptWithToolNote(basePrompt, { activeToolIds: activeTools, useTextHint, hasOtherTools: getToolExtensions().some(e => e.enabledToolCount() > 0) }),
    isRemote,
    { isLiteRT, thinkingEnabled: deps.settings.thinkingEnabled },
  );
  const messagesForContext = buildMessagesForContext({
    conversationId: targetConversationId,
    messageText,
    systemPrompt,
    includeCompactionSummary: !isRemote,
  });
  await prepareContext(setDebugInfo, systemPrompt, messagesForContext);
  try {
    await generateWithCompactionRetry({
      generation: { id: targetConversationId, prompt: systemPrompt, messages: messagesForContext },
      enabledTools: activeTools,
      projectId: conversation?.projectId,
      includePreviousSummary: !isRemote,
    });
  } catch (error: any) {
    const msg = error?.message || error?.toString?.() || 'Failed to generate response';
    logger.error('[ChatGen] Generation failed:', msg, error);
    const isContextOverflow = msg.includes('too long') || msg.includes('Exceeding the maximum number of tokens') || msg.includes('Input token ids');
    if (isContextOverflow) {
      deps.setAlertState({
        ...showAlert(
          'Context window full',
          'The conversation is too long for this model\'s context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.',
          [
            {
              text: 'Settings',
              onPress: () => { deps.setAlertState({ visible: false, title: '', message: '', buttons: [] }); deps.setShowSettingsPanel?.(true); },
            },
            {
              text: 'New chat',
              onPress: () => {
                deps.setAlertState({ visible: false, title: '', message: '', buttons: [] });
                const modelId = deps.activeModelInfo?.modelId;
                if (modelId) {
                  const serverId = deps.activeModelInfo?.isRemote ? deps.activeModelInfo.serverId : undefined;
                  const newId = deps.createConversation(modelId, undefined, undefined, serverId);
                  deps.setActiveConversation(newId);
                }
              },
            },
          ],
        ),
        prominentMessage: true,
      });
    } else {
      deps.setAlertState(showAlert('Generation Error', msg));
    }
    deps.generatingForConversationRef.current = null;
    return;
  }
  deps.generatingForConversationRef.current = null;
}
let _msgIdSeq = 0; const nextMsgId = () => `${Date.now()}-${(++_msgIdSeq).toString(36)}`;
export type DispatchCall = { text: string; attachments?: MediaAttachment[]; conversationId: string; imageMode?: 'auto' | 'force' | 'disabled' };
/**
 * THE routing layer: the single place a message is classified and dispatched to
 * image or text generation. Every entry point (new send, queued-message drain)
 * funnels through here, so the decision is made once and never duplicated in an
 * executor. `startTextGeneration` is the pure text executor (it does not route).
 */
export async function dispatchGenerationFn(
  deps: GenerationDeps,
  call: DispatchCall,
  startTextGeneration: (convId: string, messageText: string) => Promise<void>,
): Promise<void> {
  const { text, attachments, conversationId, imageMode = 'auto' } = call;
  let messageText = appendAttachmentText(text, attachments);
  const shouldGenerateImage = imageMode !== 'disabled' && await shouldRouteToImageGenerationFn(deps, messageText, imageMode === 'force');
  if (shouldGenerateImage && deps.activeImageModel) {
    await handleImageGenerationFn(deps, { prompt: text, conversationId, attachments }); // adds user msg (keeps voice note)
    return;
  }
  // Text route, no text model selected (image-only device): load one / open selector.
  if (!shouldGenerateImage && deps.hasTextModel === false && !deps.activeModelInfo?.isRemote) {
    const ready = await deps.ensureTextModelForChat();
    if (!ready) {
      deps.setPendingMessage?.(text, attachments);
      return;
    }
  }
  if (shouldGenerateImage && !deps.activeImageModel) messageText = `[User wanted an image but no image model is loaded] ${messageText}`;
  const userMessage = deps.addMessage(conversationId, { role: 'user', content: text, attachments });
  const conversation = useChatStore.getState().conversations.find(c => c.id === conversationId);
  await maybeCaptureMemoryCandidate({
    memoryAutoCaptureEnabled: deps.settings.memoryAutoCaptureEnabled,
    activeModelInfo: deps.activeModelInfo,
    projectId: conversation?.projectId,
    userMessage,
  });
  await startTextGeneration(conversationId, messageText);
}
export type SendCall = { text: string; attachments?: MediaAttachment[]; imageMode?: 'auto' | 'force' | 'disabled'; startGeneration: (convId: string, text: string) => Promise<void>; setDebugInfo: SetState<any> };
export async function handleSendFn(deps: GenerationDeps, call: SendCall): Promise<void> {
  const { text, attachments, imageMode, startGeneration } = call;
  abortPreload(); // user acted — stop background warming so it can't block them
  if (!deps.hasActiveModel) {
    deps.setAlertState(showAlert('No Model Selected', 'Please select a model first.'));
    return;
  }
  let targetConversationId = deps.activeConversationId;
  if (!targetConversationId) {
    const fallbackModelId = deps.activeModelInfo?.modelId || deps.activeImageModel?.id;
    const fallbackServerId = deps.activeModelInfo?.isRemote ? deps.activeModelInfo.serverId : undefined;
    targetConversationId = deps.createConversation(fallbackModelId!, undefined, deps.pendingProjectId, fallbackServerId);
    deps.setActiveConversation(targetConversationId);
  }
  // Cross-modality serialization: queue if any generation is running (routed later).
  if (generationService.getState().isGenerating || imageGenerationService.getState().isGenerating) {
    const messageText = appendAttachmentText(text, attachments);
    generationService.enqueueMessage({ id: nextMsgId(), conversationId: targetConversationId, text, attachments, messageText });
    return;
  }
  await dispatchGenerationFn(deps, { text, attachments, conversationId: targetConversationId, imageMode }, startGeneration);
}
export async function handleStopFn(deps: Pick<GenerationDeps, 'isGeneratingImage' | 'generatingForConversationRef'>): Promise<void> {
  deps.generatingForConversationRef.current = null;
  try { await generationService.stopGeneration().catch(() => { }); }
  catch (e) { logger.error('Error stopping generation:', e); }
  if (deps.isGeneratingImage) imageGenerationService.cancelGeneration().catch(() => { });
}
export async function executeDeleteConversationFn(
  deps: Pick<GenerationDeps, 'activeConversationId' | 'isStreaming' | 'clearStreamingMessage' | 'removeImagesByConversationId' | 'deleteConversation' | 'setActiveConversation' | 'navigation' | 'setAlertState'>,
): Promise<void> {
  if (!deps.activeConversationId) return;
  deps.setAlertState(hideAlert());
  if (deps.isStreaming) { await llmService.stopGeneration(); deps.clearStreamingMessage(); }
  for (const id of deps.removeImagesByConversationId(deps.activeConversationId)) await onnxImageGeneratorService.deleteGeneratedImage(id);
  contextCompactionService.clearSummary(deps.activeConversationId);
  deps.deleteConversation(deps.activeConversationId);
  deps.setActiveConversation(null);
  deps.navigation.goBack();
}
export type RegenerateCall = { setDebugInfo: SetState<any>; userMessage: Message };
export async function regenerateResponseFn(deps: GenerationDeps, call: RegenerateCall): Promise<void> {
  const { userMessage } = call;
  if (!deps.activeConversationId || !deps.hasActiveModel) return;
  const targetConversationId = deps.activeConversationId;
  const messageText = appendAttachmentText(userMessage.content, userMessage.attachments);
  const shouldGenerateImage = await shouldRouteToImageGenerationFn(deps, messageText);
  if (shouldGenerateImage && deps.activeImageModel) {
    await handleImageGenerationFn(deps, { prompt: userMessage.content, conversationId: targetConversationId, skipUserMessage: true });
    return;
  }
  if (!deps.activeModelInfo?.isRemote && deps.activeModel) {
    if (!(await ensureModelReady(deps))) {
      deps.setAlertState(showAlert('Error', 'Failed to load model. Please try again.'));
      return;
    }
  }
  deps.generatingForConversationRef.current = targetConversationId;
  // LiteRT: native history must be rewound to match the JS messages we're about to replay.
  if (deps.activeModel?.engine === 'litert') liteRTService.invalidateConversation();
  const conversation = useChatStore.getState().conversations.find(c => c.id === targetConversationId);
  const messages = (conversation?.messages || []).filter((m: Message) => !m.isSystemInfo);
  const messagesUpToUser = messages.slice(0, messages.findIndex((m: Message) => m.id === userMessage.id) + 1)
    .map(m => m.id === userMessage.id ? { ...m, content: messageText } : m);
  const { enabledTools, rawPrompt, isLiteRT: isLiteRTRegen } = resolveToolsAndPrompt(deps, conversation, messageText);
  const isRemote = isRemoteGeneration({ activeModelInfo: deps.activeModelInfo });
  const activeTools = enabledTools;
  const basePrompt = await injectChatContext({
    projectId: conversation?.projectId,
    query: messageText,
    prompt: rawPrompt,
    includeMemory: !isRemote,
  });
  const useTextHint = !isRemote && !isLiteRTRegen && activeTools.length > 0 && !llmService.supportsToolCalling();
  // MCP/extension hints come solely from augmentSystemPromptForTools in the tool loop
  // (see the send path above) — adding them here too would double-inject.
  const systemPrompt = applyGemma4ThinkToken(
    buildPromptWithToolNote(basePrompt, { activeToolIds: activeTools, useTextHint, hasOtherTools: getToolExtensions().some(e => e.enabledToolCount() > 0) }),
    isRemote,
    { isLiteRT: isLiteRTRegen, thinkingEnabled: deps.settings.thinkingEnabled },
  );
  const messagesForContext = buildMessagesWithCompactionPrefix({
    conversation,
    systemPrompt,
    messages: messagesUpToUser,
    includeCompactionSummary: !isRemote,
  });
  try {
    await generateWithCompactionRetry({
      generation: { id: targetConversationId, prompt: systemPrompt, messages: messagesForContext },
      enabledTools: activeTools,
      projectId: conversation?.projectId,
      includePreviousSummary: !isRemote,
    });
  } catch (error: any) {
    const msg = error?.message || 'Failed to generate response';
    const isContextOverflow = msg.includes('too long') || msg.includes('Exceeding the maximum number of tokens') || msg.includes('Input token ids');
    if (isContextOverflow) {
      deps.setAlertState({
        ...showAlert(
          'Context window full',
          'The conversation is too long for this model\'s context window.\n\nIncrease the context limit in Settings, reduce the number of enabled tools, or start a new chat.',
          [
            {
              text: 'Settings',
              onPress: () => { deps.setAlertState({ visible: false, title: '', message: '', buttons: [] }); deps.setShowSettingsPanel?.(true); },
            },
            {
              text: 'New chat',
              onPress: () => {
                deps.setAlertState({ visible: false, title: '', message: '', buttons: [] });
                const modelId = deps.activeModelInfo?.modelId;
                if (modelId) {
                  const serverId = deps.activeModelInfo?.isRemote ? deps.activeModelInfo.serverId : undefined;
                  const newId = deps.createConversation(modelId, undefined, undefined, serverId);
                  deps.setActiveConversation(newId);
                }
              },
            },
          ],
        ),
        prominentMessage: true,
      });
    } else {
      deps.setAlertState(showAlert('Generation Error', msg));
    }
  }
  deps.generatingForConversationRef.current = null;
}
export type SelectProjectDeps = { activeConversationId: string | null | undefined; setConversationProject: (convId: string, projectId: string | null) => void; setShowProjectSelector: SetState<boolean> };
export function handleSelectProjectFn(deps: SelectProjectDeps, project: Project | null): void {
  if (deps.activeConversationId) deps.setConversationProject(deps.activeConversationId, project?.id || null);
  deps.setShowProjectSelector(false); }
