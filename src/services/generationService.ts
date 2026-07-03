/** GenerationService - Handles LLM generation independently of UI lifecycle */
import { llmService } from './llm';
import { liteRTService } from './litert';
import { getActiveEngineService } from './engines';
import { useAppStore, useChatStore, useRemoteServerStore } from '../stores';
import { Message, GenerationMeta, MediaAttachment } from '../types';
import { runToolLoop, type SteeringMessage } from './generationToolLoop';
import type { ToolResult } from './tools/types';
import { providerRegistry } from './providers';
import logger from '../utils/logger';
import { shouldShowSharePrompt, emitSharePrompt } from '../utils/sharePrompt';
import { checkProPromptForText } from '../utils/proPrompt';
import {
  buildGenerationMetaImpl,
  buildToolLoopHandlersImpl,
  prepareGenerationImpl,
  generateResponseImpl,
  generateRemoteResponseImpl,
  generateRemoteWithToolsImpl,
  type GenerationWithToolsRequest,
} from './generationServiceHelpers';
import { armStallWatchdog, pokeStallWatchdog, disarmStallWatchdog, rearmStallWatchdog } from './generationStallWatchdog';

const SHARE_PROMPT_DELAY_MS = 1500;
type StreamChunk = string | { content?: string; reasoningContent?: string };

export interface QueuedMessage {
  id: string; conversationId: string; text: string;
  attachments?: MediaAttachment[]; messageText: string;
}

export interface GenerationState {
  isGenerating: boolean;
  isThinking: boolean;
  conversationId: string | null;
  streamingContent: string;
  startTime: number | null;
  queuedMessages: QueuedMessage[];
}

type GenerationListener = (state: GenerationState) => void;
type QueueProcessor = (item: QueuedMessage) => Promise<void>;

class GenerationService {
  private state: GenerationState = {
    isGenerating: false, isThinking: false, conversationId: null,
    streamingContent: '', startTime: null, queuedMessages: [],
  };

  private listeners: Set<GenerationListener> = new Set();
  private abortRequested: boolean = false;
  private pendingStop: Promise<void> | null = null;
  private queueProcessor: QueueProcessor | null = null;
  private currentRemoteAbortController: AbortController | null = null;
  private remoteTimeToFirstToken: number | undefined;

  // Token batching — collect tokens and flush to UI at a controlled rate
  private tokenBuffer: string = '';
  private reasoningBuffer: string = '';
  private totalReasoningLength: number = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  // No-progress watchdog for the active generation (see GENERATION_STALL_TIMEOUT_MS).
  private stallTimer: ReturnType<typeof setTimeout> | null = null;
  private stallReject: ((error: Error) => void) | null = null;

  /** Get the current provider (local or remote) */
  private getCurrentProvider() {
    const activeServerId = useRemoteServerStore.getState().activeServerId;
    if (activeServerId) {
      return providerRegistry.getProvider(activeServerId);
    }
    return providerRegistry.getProvider('local');
  }

  /** Check if using a remote provider */
  private isUsingRemoteProvider(): boolean {
    const { activeServerId } = useRemoteServerStore.getState();
    const hasProvider = activeServerId ? providerRegistry.hasProvider(activeServerId) : false;
    const localLoaded = llmService.isModelLoaded();
    if (!activeServerId) return false;
    // Provider must be registered (not just persisted from a previous session)
    if (!hasProvider) return false;
    // If a local model is loaded, prefer it over the remote server.
    // Log a warning so this is diagnosable if a user selects remote but gets local responses.
    if (localLoaded) {
      logger.warn('[GenerationService] Local model is loaded — preferring local over active remote server:', activeServerId);
      return false;
    }
    return true;
  }

  private flushTokenBuffer(): void {
    const store = useChatStore.getState();
    let flushed = false;
    if (this.tokenBuffer) {
      store.appendToStreamingMessage(this.tokenBuffer);
      this.tokenBuffer = '';
      flushed = true;
    }
    if (this.reasoningBuffer) {
      store.appendToStreamingReasoningContent(this.reasoningBuffer);
      this.reasoningBuffer = '';
      flushed = true;
    }
    this.flushTimer = null;
    // Any content reaching the UI is a sign of life — keep the stall watchdog at bay.
    if (flushed) pokeStallWatchdog(this);
  }

  private forceFlushTokens(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flushTokenBuffer();
  }

  private normalizeStreamChunk(data: StreamChunk): { content?: string; reasoningContent?: string } {
    return typeof data === 'string' ? { content: data } : data;
  }

  /** Re-arm the stall watchdog after progress. Exposed for tool-loop handlers (svc.notifyStallProgress). */
  private notifyStallProgress(): void { pokeStallWatchdog(this); }

  getState(): GenerationState { return { ...this.state }; }

  isGeneratingFor(conversationId: string): boolean {
    return this.state.isGenerating && this.state.conversationId === conversationId;
  }

  subscribe(listener: GenerationListener): () => void {
    this.listeners.add(listener); listener(this.getState()); return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void { this.listeners.forEach(l => l(this.getState())); }

  private updateState(partial: Partial<GenerationState>): void {
    this.state = { ...this.state, ...partial };
    this.notifyListeners();
  }

  private checkSharePrompt(delayMs = SHARE_PROMPT_DELAY_MS): void {
    const s = useAppStore.getState();
    const count = s.incrementTextGenerationCount();
    if (!s.hasEngagedSharePrompt && shouldShowSharePrompt(count)) setTimeout(() => emitSharePrompt('text'), delayMs);
    checkProPromptForText(delayMs);
  }

  private buildToolLoopHandlers() { return buildToolLoopHandlersImpl(this); }
  private buildGenerationMeta(): GenerationMeta { return buildGenerationMetaImpl(this); }
  private async prepareGeneration(conversationId: string): Promise<boolean> {
    return prepareGenerationImpl(this, conversationId);
  }

  /** Generate a response for a conversation. Runs independently of UI lifecycle. */
  async generateResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void,
  ): Promise<void> {
    return armStallWatchdog(this, () => {
      // Route to remote provider if active
      if (this.isUsingRemoteProvider()) {
        return this.generateRemoteResponse(conversationId, messages, onFirstToken);
      }
      return generateResponseImpl(this, { conversationId, messages, onFirstToken });
    });
  }

  /** Generate a response with tool calling support (LLM → tools → repeat, max 5 iterations). */
  async generateWithTools(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    // Pause the watchdog while a (possibly slow) tool runs and resume when it
    // returns, so a legitimate long tool call can't be misread as a model stall.
    const guardedOptions = { ...options, ...this.withProgressCallbacks(options) };
    return armStallWatchdog(this, () => {
      // Route to remote provider if active
      if (this.isUsingRemoteProvider()) {
        return this.generateRemoteWithTools(conversationId, messages, guardedOptions);
      }
      return this.runLocalToolGeneration(conversationId, messages, guardedOptions);
    });
  }

  /** Wrap the caller's tool-call callbacks to pause/resume the stall watchdog around
   *  tool execution (a slow tool is not a model stall). */
  private withProgressCallbacks<T extends {
    onToolCallStart?: (name: string, args: Record<string, any>) => void;
    onToolCallComplete?: (name: string, result: ToolResult) => void;
  }>(callbacks: T): Pick<T, 'onToolCallStart' | 'onToolCallComplete'> {
    return {
      onToolCallStart: (name: string, args: Record<string, any>) => {
        disarmStallWatchdog(this); // pause: the tool, not the model, is working now
        callbacks.onToolCallStart?.(name, args);
      },
      onToolCallComplete: (name: string, result: ToolResult) => {
        rearmStallWatchdog(this); // resume with a fresh budget for the model's next step
        callbacks.onToolCallComplete?.(name, result);
      },
    } as Pick<T, 'onToolCallStart' | 'onToolCallComplete'>;
  }

  private async runLocalToolGeneration(
    conversationId: string,
    messages: Message[],
    options: {
      enabledToolIds: string[];
      projectId?: string;
      onToolCallStart?: (name: string, args: Record<string, any>) => void;
      onToolCallComplete?: (name: string, result: ToolResult) => void;
      onFirstToken?: () => void;
    },
  ): Promise<void> {
    // Local generation with tools
    const { enabledToolIds, projectId, ...callbacks } = options;
    if (!(await this.prepareGeneration(conversationId))) return;
    const chatStore = useChatStore.getState();

    try {
      await runToolLoop({
        conversationId,
        messages,
        enabledToolIds,
        projectId,
        callbacks,
        ...this.buildToolLoopHandlers(),
      });

      // If aborted, stopGeneration() already handled cleanup.
      logger.log(`[GenService][ToolLoop] runToolLoop done — aborted=${this.abortRequested}, streamingContent=${this.state.streamingContent?.length ?? 0}ch, tokenBuffer=${this.tokenBuffer?.length ?? 0}ch`);
      if (!this.abortRequested) {
        this.forceFlushTokens();
        const store = useChatStore.getState();
        logger.log(`[GenService][ToolLoop] pre-finalize — streamingForConvId=${store.streamingForConversationId}, targetConvId=${conversationId}, streamingMsg=${store.streamingMessage?.length ?? 0}ch`);
        const generationTime = this.state.startTime ? Date.now() - this.state.startTime : undefined;
        store.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
        logger.log(`[GenService][ToolLoop] finalizeStreamingMessage called — convId=${conversationId}`);
        this.checkSharePrompt();
        this.resetState();
      }
    } catch (error) {
      if (this.abortRequested) return;
      logger.error('[GenerationService] Tool generation error:', error);
      if (this.flushTimer) {
        clearTimeout(this.flushTimer);
        this.flushTimer = null;
      }
      this.tokenBuffer = '';
      chatStore.clearStreamingMessage();
      this.resetState();
      throw error;
    }
  }

  /** Stop the current generation. Returns partial content if any was generated. */
  async stopGeneration(): Promise<string> {
    if (!this.state.isGenerating) {
      // Stop all engines and remote
      await llmService.stopGeneration().catch(() => { });
      await liteRTService.stopGeneration().catch(() => { });
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      // Ensure chat store streaming state is cleared even if generation
      // service already reset — prevents stuck stop button.
      useChatStore.getState().clearStreamingMessage();
      return '';
    }

    // Set abort flag BEFORE stopping so the onComplete callback
    // knows we're stopping and won't finalize/reset on its own.
    this.abortRequested = true;
    this.forceFlushTokens();

    const { conversationId, streamingContent, startTime } = this.state;
    const generationTime = startTime ? Date.now() - startTime : undefined;

    const chatStore = useChatStore.getState();
    if (conversationId && streamingContent.trim()) {
      chatStore.finalizeStreamingMessage(conversationId, generationTime, this.buildGenerationMeta());
      this.checkSharePrompt();
    } else {
      chatStore.clearStreamingMessage();
    }

    this.resetState();

    // Stop both local and remote
    if (this.isUsingRemoteProvider()) {
      // Abort the provider's XHR so the server connection is closed immediately
      const provider = this.getCurrentProvider();
      if (provider) provider.stopGeneration().catch(() => { });
      if (this.currentRemoteAbortController) {
        this.currentRemoteAbortController.abort();
        this.currentRemoteAbortController = null;
      }
      return streamingContent;
    }

    // Stop the native completion after we've already updated UI state,
    // so the user sees immediate feedback. Store the promise so new
    // generations can drain it before starting.
    const engine = getActiveEngineService();
    this.pendingStop = (engine?.stopGeneration() ?? Promise.resolve())
      .catch(() => { })
      .finally(() => { this.pendingStop = null; });

    return streamingContent;
  }

  /** Generate a response using a remote provider */
  async generateRemoteResponse(
    conversationId: string,
    messages: Message[],
    onFirstToken?: () => void,
  ): Promise<void> {
    return generateRemoteResponseImpl(this, { conversationId, messages, onFirstToken });
  }

  /** Generate a response with tools using a remote provider */
  async generateRemoteWithTools(
    conversationId: string,
    messages: Message[],
    options: GenerationWithToolsRequest['options'],
  ): Promise<void> {
    return generateRemoteWithToolsImpl(this, { conversationId, messages, options });
  }

  enqueueMessage(entry: QueuedMessage): void {
    this.state = { ...this.state, queuedMessages: [...this.state.queuedMessages, entry] };
    this.notifyListeners();
  }

  removeFromQueue(id: string): void {
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.id !== id) };
    this.notifyListeners();
  }

  clearQueue(): void { this.state = { ...this.state, queuedMessages: [] }; this.notifyListeners(); }

  /**
   * Mid-turn steering: pull messages the user queued for the CURRENTLY generating
   * conversation so the tool loop can fold them into this turn (Claude-Code style)
   * instead of replaying them as a separate turn after it finishes. Messages for
   * other conversations stay queued. Returns them as user messages to append.
   */
  drainSteeringMessages(): SteeringMessage[] {
    const convId = this.state.conversationId;
    if (!convId || this.state.queuedMessages.length === 0) return [];
    const mine = this.state.queuedMessages.filter(m => m.conversationId === convId);
    if (mine.length === 0) return [];
    this.state = { ...this.state, queuedMessages: this.state.queuedMessages.filter(m => m.conversationId !== convId) };
    this.notifyListeners();
    return mine.map(m => {
      const base = { id: `steer-${m.id}`, role: 'user' as const, attachments: m.attachments, timestamp: Date.now() };
      // Keep the display/context split the normal send path uses: `text` renders in
      // the bubble; `messageText` (with any appended document text) goes to the model.
      return { display: { ...base, content: m.text }, forModel: { ...base, content: m.messageText } };
    });
  }

  setQueueProcessor(processor: QueueProcessor | null): void {
    this.queueProcessor = processor;
    // A processor can be null between screen unmount and the next mount. If a
    // generation finished during that gap, processNextInQueue bailed without
    // draining and nothing rescheduled it — the message was stranded in the
    // queue. When a processor (re)appears and nothing is running, drain it now so
    // queued messages can never get stuck.
    if (processor && !this.state.isGenerating && this.state.queuedMessages.length > 0) {
      setTimeout(() => this.processNextInQueue(), 0);
    }
  }

  /**
   * Process queued messages now. Text generation drains its own queue on
   * completion, but image generation finishes outside this service, so the
   * image path calls this to release messages that queued behind it. No-op if a
   * text generation is currently running.
   */
  drainQueue(): void {
    if (this.state.isGenerating) return;
    this.processNextInQueue();
  }

  private processNextInQueue(): void {
    // Defensive: never evict/dispatch a queued message while a generation is in
    // flight — prepareGeneration would reject the drained message as a no-op and
    // it would be lost. Callers already gate on this, but the singleton state is
    // shared, so guard here too.
    if (this.state.isGenerating || this.state.queuedMessages.length === 0 || !this.queueProcessor) return;
    const all = this.state.queuedMessages;
    // Only drain one conversation per pass. Messages for other chats stay queued
    // and drain on a later pass (after this generation completes, or when their
    // chat becomes active) — never merged into the wrong conversation.
    const targetConversationId = all[0].conversationId;
    const forConversation = all.filter(m => m.conversationId === targetConversationId);
    const rest = all.filter(m => m.conversationId !== targetConversationId);
    this.state = { ...this.state, queuedMessages: rest };
    this.notifyListeners();
    const combined: QueuedMessage = forConversation.length === 1 ? forConversation[0] : {
      id: forConversation[0].id, conversationId: targetConversationId,
      text: forConversation.map(m => m.text).join('\n\n'),
      attachments: forConversation.flatMap(m => m.attachments || []),
      messageText: forConversation.map(m => m.messageText).join('\n\n'),
    };
    this.queueProcessor(combined).catch(e => {
      logger.error('[GenerationService] Queue processor error:', e);
      // The failed group won't self-drain via resetState (no generation started),
      // so kick the remaining conversations along here.
      if (rest.length > 0) setTimeout(() => this.processNextInQueue(), 100);
    });
  }

  private resetState(): void {
    const hasQueuedItems = this.state.queuedMessages.length > 0;
    disarmStallWatchdog(this);
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.tokenBuffer = '';
    this.reasoningBuffer = '';
    this.totalReasoningLength = 0;
    this.remoteTimeToFirstToken = undefined;
    this.updateState({
      isGenerating: false,
      isThinking: false,
      conversationId: null,
      streamingContent: '',
      startTime: null,
    });
    if (hasQueuedItems) {
      setTimeout(() => this.processNextInQueue(), 100);
    }
  }
}

export const generationService = new GenerationService();
