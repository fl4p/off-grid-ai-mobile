import { Message, MediaAttachment } from '../types';
import { stripControlTokens } from './messageContent';

const ROLE_LABELS: Record<Message['role'], string> = {
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
};

/** True when any message in the conversation carries reasoning/thinking text. */
export function conversationHasReasoning(messages: Message[]): boolean {
  return messages.some((m) => !!m.reasoningContent && m.reasoningContent.trim().length > 0);
}

/** A short "[image: cat.png]" style placeholder so attachment-only turns aren't lost. */
function describeAttachment(attachment: MediaAttachment): string {
  return attachment.fileName ? `[${attachment.type}: ${attachment.fileName}]` : `[${attachment.type}]`;
}

/** A message contributes to the transcript when it has content, reasoning or attachments. */
function isTranscriptMessage(message: Message): boolean {
  if (message.isSystemInfo) return false;
  const hasContent = stripControlTokens(message.content || '').length > 0;
  const hasReasoning = !!message.reasoningContent && message.reasoningContent.trim().length > 0;
  const hasAttachments = !!message.attachments && message.attachments.length > 0;
  return hasContent || hasReasoning || hasAttachments;
}

/**
 * Build a plain-text transcript of a conversation suitable for the clipboard.
 * Each turn is labelled by role. When `includeReasoning` is set, the model's
 * thinking text (when present) is emitted before its response. Attachment-only
 * turns are represented by a short placeholder so no turn is silently dropped.
 */
export function buildTranscript(
  messages: Message[],
  options: { includeReasoning?: boolean } = {},
): string {
  const { includeReasoning = false } = options;
  const blocks: string[] = [];

  for (const message of messages) {
    if (!isTranscriptMessage(message)) continue;

    const label = ROLE_LABELS[message.role] || message.role;

    if (includeReasoning && message.reasoningContent && message.reasoningContent.trim().length > 0) {
      blocks.push(`${label} (thinking):\n${message.reasoningContent.trim()}`);
    }

    const parts: string[] = [];
    if (message.attachments && message.attachments.length > 0) {
      parts.push(message.attachments.map(describeAttachment).join(' '));
    }
    const content = stripControlTokens(message.content || '');
    if (content.length > 0) {
      parts.push(content);
    }

    if (parts.length > 0) {
      blocks.push(`${label}:\n${parts.join('\n')}`);
    }
  }

  return blocks.join('\n\n');
}
