import React, { useCallback, useState } from 'react';
import { ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/Feather';

import { showAlert, type AlertState } from '../components/CustomAlert';
import { memoryService, type MemoryItem } from '../services/memory';

export interface ProjectDetailMemorySectionProps {
  projectId: string;
  colors: any;
  styles: any;
  setAlertState: (state: AlertState) => void;
  onNavigateToMemory: () => void;
}

export const ProjectDetailMemorySection: React.FC<ProjectDetailMemorySectionProps> = ({
  projectId,
  colors,
  styles,
  setAlertState,
  onNavigateToMemory,
}) => {
  const [memories, setMemories] = useState<MemoryItem[]>([]);

  const loadMemories = useCallback(async () => {
    try {
      setMemories(await memoryService.listMemories(projectId));
    } catch (err: any) {
      setAlertState(showAlert('Error', err?.message || 'Failed to load memories'));
    }
  }, [projectId, setAlertState]);

  useFocusEffect(useCallback(() => {
    loadMemories();
  }, [loadMemories]));

  const previewMemories = memories.slice(0, 3);

  return (
    <View style={styles.sectionContent}>
      <TouchableOpacity style={styles.sectionHeader} onPress={onNavigateToMemory} activeOpacity={0.7}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>Memory</Text>
          {memories.length > 0 && <Text style={styles.sectionCount}>{memories.length}</Text>}
        </View>
        <View style={styles.sectionActions}>
          <Icon name="chevron-right" size={16} color={colors.textMuted} style={styles.navIcon} />
        </View>
      </TouchableOpacity>

      {memories.length === 0 ? (
        <View style={styles.emptyState}>
          <Icon name="bookmark" size={24} color={colors.textMuted} />
          <Text style={styles.emptyStateText}>No memories saved</Text>
        </View>
      ) : (
        <ScrollView style={styles.sectionList} nestedScrollEnabled>
          {previewMemories.map((memory) => (
            <TouchableOpacity key={memory.id} style={styles.memoryRow} onPress={onNavigateToMemory} activeOpacity={0.7}>
              <View style={styles.memoryPreviewIcon}>
                <Icon name="bookmark" size={13} color={colors.textMuted} />
              </View>
              <View style={styles.memoryPreviewInfo}>
                <View style={styles.memoryPreviewHeader}>
                  <Text style={styles.memoryPreviewTitle} numberOfLines={1}>{memory.title}</Text>
                  <Text style={styles.memoryPreviewScope}>{memory.scope === 'project' ? 'Project' : 'Shared'}</Text>
                </View>
                <Text style={styles.memoryPreviewBody} numberOfLines={1}>{memory.body}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </View>
  );
};
