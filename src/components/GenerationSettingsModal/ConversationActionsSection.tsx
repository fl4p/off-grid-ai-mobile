import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { createStyles } from './styles';

interface ConversationActionsSectionProps {
  // Each action is pre-wrapped by the parent to close this sheet FIRST and run
  // only after it has fully dismissed. iOS can't present a sheet/alert while
  // another modal is still dismissing, so firing these on a fixed timeout (the
  // old behaviour) deadlocked the app. See GenerationSettingsModal.runAfterClose.
  onOpenProject?: () => void;
  onOpenGallery?: () => void;
  onOpenMemory?: () => void;
  onDeleteConversation?: () => void;
  onCopyTranscript?: () => void;
  conversationImageCount: number;
  activeProjectName?: string | null;
}

export const ConversationActionsSection: React.FC<ConversationActionsSectionProps> = ({
  onOpenProject,
  onOpenGallery,
  onOpenMemory,
  onDeleteConversation,
  onCopyTranscript,
  conversationImageCount,
  activeProjectName,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const hasActions = onOpenProject || onOpenGallery || onOpenMemory || onDeleteConversation || onCopyTranscript;
  if (!hasActions) {
    return null;
  }

  return (
    <View>
      {onOpenProject && (
        <TouchableOpacity style={styles.actionRow} onPress={onOpenProject}>
          <Icon name="folder" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>
            Project: {activeProjectName || 'Default'}
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onOpenGallery && conversationImageCount > 0 && (
        <TouchableOpacity style={styles.actionRow} onPress={onOpenGallery}>
          <Icon name="image" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>
            Gallery ({conversationImageCount})
          </Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onOpenMemory && (
        <TouchableOpacity style={styles.actionRow} onPress={onOpenMemory}>
          <Icon name="bookmark" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>Manage Memory</Text>
          <Icon name="chevron-right" size={16} color={colors.textMuted} />
        </TouchableOpacity>
      )}
      {onCopyTranscript && (
        <TouchableOpacity style={styles.actionRow} onPress={onCopyTranscript}>
          <Icon name="copy" size={16} color={colors.textSecondary} />
          <Text style={styles.actionText}>Copy Transcript</Text>
        </TouchableOpacity>
      )}
      {onDeleteConversation && (
        <TouchableOpacity style={styles.actionRow} onPress={onDeleteConversation}>
          <Icon name="trash-2" size={16} color={colors.error} />
          <Text style={styles.actionTextError}>Delete Conversation</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};
