import React, { useState, useEffect, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Switch } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { AppSheet } from '../AppSheet';
import { useTheme, useThemedStyles } from '../../theme';
import { useAppStore } from '../../stores';
import { llmService } from '../../services';
import { createStyles } from './styles';
import { ConversationActionsSection } from './ConversationActionsSection';
import { ImageGenerationSection } from './ImageGenerationSection';
import { TextGenerationSection } from './TextGenerationSection';
import { getSlot, SLOTS } from '../../bootstrap/slotRegistry';

const DEFAULT_SETTINGS = {
  temperature: 0.7,
  maxTokens: 1024,
  topP: 0.9,
  repeatPenalty: 1.1,
  contextLength: 4096,
  nThreads: 0,
  nBatch: 512,
};

function hasAnyAction(actions: Array<unknown>): boolean {
  return actions.some(Boolean);
}

function afterSheetClose(action: (() => void) | undefined, runAfterClose: (action: () => void) => void): (() => void) | undefined {
  if (!action) return undefined;
  return () => runAfterClose(action);
}

interface GenerationSettingsModalProps {
  visible: boolean;
  onClose: () => void;
  onOpenProject?: () => void;
  onOpenGallery?: () => void;
  onOpenMemory?: () => void;
  onDeleteConversation?: () => void;
  onCopyTranscript?: () => void;
  onOpenTTSSettings?: () => void;
  conversationImageCount?: number;
  activeProjectName?: string | null;
  isRemote?: boolean;
  memoryEnabled?: boolean;
  memoryDisabledByProject?: boolean;
  onMemoryEnabledChange?: (enabled: boolean) => void;
}

export const GenerationSettingsModal: React.FC<GenerationSettingsModalProps> = ({
  visible,
  onClose,
  onOpenProject,
  onOpenGallery,
  onOpenMemory,
  onDeleteConversation,
  onCopyTranscript,
  onOpenTTSSettings,
  conversationImageCount = 0,
  activeProjectName,
  isRemote,
  memoryEnabled = true,
  memoryDisabledByProject = false,
  onMemoryEnabledChange,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const { updateSettings } = useAppStore();

  const [performanceStats, setPerformanceStats] = useState(llmService.getPerformanceStats());
  const [imageSettingsOpen, setImageSettingsOpen] = useState(false);
  const [textSettingsOpen, setTextSettingsOpen] = useState(false);
  const [ttsSettingsOpen, setTtsSettingsOpen] = useState(false);
  // TTS settings come from the pro audio feature via a slot. Free builds have
  // no TTS section.
  const TtsSection = getSlot(SLOTS.generationSettingsTts);

  useEffect(() => {
    if (visible) {
      setPerformanceStats(llmService.getPerformanceStats());
    }
  }, [visible]);

  const handleResetDefaults = () => {
    updateSettings(DEFAULT_SETTINGS);
  };

  // Conversation actions (open project/gallery, delete, copy transcript) each
  // present another sheet or a confirm alert. On iOS a modal can't be presented
  // while this one is still dismissing, so we close FIRST and run the action from
  // AppSheet's onClosed (fired after the close animation completes) not a timeout.
  const pendingAfterCloseRef = useRef<(() => void) | null>(null);
  const runAfterClose = (action: () => void) => {
    pendingAfterCloseRef.current = action;
    onClose();
  };
  const handleClosed = () => {
    const action = pendingAfterCloseRef.current;
    pendingAfterCloseRef.current = null;
    action?.();
  };

  const hasConversationActions = hasAnyAction([
    onOpenProject,
    onOpenGallery,
    onDeleteConversation,
    onCopyTranscript,
  ]);
  const openMemoryAfterClose = afterSheetClose(onOpenMemory, runAfterClose);
  const showManageMemory = !!(onMemoryEnabledChange && memoryEnabled && openMemoryAfterClose);

  return (
    <AppSheet
      visible={visible}
      onClose={onClose}
      onClosed={handleClosed}
      snapPoints={['50%', '90%']}
      title="Chat Settings"
    >
      {performanceStats.lastTokensPerSecond > 0 && (
        <View style={styles.statsBar}>
          <Text style={styles.statsLabel}>Last Generation:</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokensPerSecond.toFixed(1)} tok/s
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastTokenCount} tokens
          </Text>
          <Text style={styles.statsSeparator}>•</Text>
          <Text style={styles.statsValue}>
            {performanceStats.lastGenerationTime.toFixed(1)}s
          </Text>
        </View>
      )}

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.contentContainer}
        showsVerticalScrollIndicator={false}
      >
        <ConversationActionsSection
          onOpenProject={afterSheetClose(onOpenProject, runAfterClose)}
          onOpenGallery={afterSheetClose(onOpenGallery, runAfterClose)}
          onDeleteConversation={afterSheetClose(onDeleteConversation, runAfterClose)}
          onCopyTranscript={afterSheetClose(onCopyTranscript, runAfterClose)}
          conversationImageCount={conversationImageCount}
          activeProjectName={activeProjectName}
        />

        {onMemoryEnabledChange && (
          <View testID="chat-memory-section">
            <View testID="chat-memory-control-row" style={styles.memoryControlRow}>
              <Icon name="bookmark" size={16} color={colors.textSecondary} />
              <View style={styles.memoryControlText}>
                <Text style={styles.actionText}>Memory</Text>
                <Text style={styles.memoryControlDescription}>
                  {memoryDisabledByProject
                    ? 'Disabled by project settings'
                    : 'Use local memory recall and suggestions in this chat'}
                </Text>
              </View>
              <Switch
                testID="chat-memory-toggle"
                value={memoryEnabled}
                disabled={memoryDisabledByProject}
                onValueChange={onMemoryEnabledChange}
                trackColor={{ false: colors.border, true: colors.primary }}
                thumbColor={colors.surface}
              />
            </View>

            {showManageMemory && (
              <TouchableOpacity
                testID="chat-manage-memory-row"
                style={styles.actionRow}
                onPress={openMemoryAfterClose}
              >
                <Icon name="bookmark" size={16} color={colors.textSecondary} />
                <Text style={styles.actionText}>Manage Memory</Text>
                <Icon name="chevron-right" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* IMAGE GENERATION SETTINGS */}
        <TouchableOpacity
          style={[
            styles.accordionHeader,
            !hasConversationActions && styles.accordionHeaderNoMargin,
          ]}
          onPress={() => setImageSettingsOpen(!imageSettingsOpen)}
          activeOpacity={0.7}
        >
          <Text style={styles.accordionTitle}>IMAGE GENERATION</Text>
          <Icon
            name={imageSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {imageSettingsOpen && <ImageGenerationSection />}

        {/* TEXT GENERATION SETTINGS */}
        <TouchableOpacity
          style={styles.accordionHeader}
          onPress={() => setTextSettingsOpen(!textSettingsOpen)}
          activeOpacity={0.7}
        >
          <Text style={styles.accordionTitle}>TEXT GENERATION</Text>
          <Icon
            name={textSettingsOpen ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        </TouchableOpacity>
        {textSettingsOpen && (
          <>
            {isRemote && (
              <View style={styles.remoteNotice}>
                <Icon name="info" size={13} color={colors.textMuted} />
                <Text style={styles.remoteNoticeText}>
                  These settings only apply to local models and won't affect the current remote session.
                </Text>
              </View>
            )}
            <TextGenerationSection />
          </>
        )}

        {/* TTS SETTINGS (pro audio feature) */}
        {TtsSection && (
          <>
            <TouchableOpacity
              style={styles.accordionHeader}
              onPress={() => setTtsSettingsOpen(!ttsSettingsOpen)}
              activeOpacity={0.7}
            >
              <Text style={styles.accordionTitle}>TEXT TO SPEECH</Text>
              <Icon
                name={ttsSettingsOpen ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {ttsSettingsOpen && (
              <TtsSection onNavigateToTTSSettings={onOpenTTSSettings} />
            )}
          </>
        )}

        <TouchableOpacity style={styles.resetButton} onPress={handleResetDefaults}>
          <Text style={styles.resetButtonText}>Reset to Defaults</Text>
        </TouchableOpacity>

        <View style={styles.bottomPadding} />
      </ScrollView>
    </AppSheet>
  );
};
