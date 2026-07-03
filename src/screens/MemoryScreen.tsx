import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Switch,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { useAppStore, useProjectStore } from '../stores';
import { memoryService, type MemoryCandidate, type MemoryItem } from '../services/memory';
import { RootStackParamList } from '../navigation/types';
import { createStyles } from './MemoryScreen.styles';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'Memory'>;
type MemoryScopeFilter = 'all' | 'project' | 'global';

const SCOPE_FILTERS: Array<{ value: MemoryScopeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'project', label: 'Project' },
  { value: 'global', label: 'Shared' },
];

function kindLabel(kind: MemoryItem['kind']): string {
  return kind.split('_').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

export function parseMemoryDisplayDate(value: string): Date {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnly) {
    return new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
  }
  return new Date(value);
}

function formatDate(value?: string | null): string {
  if (!value) return '';
  const date = parseMemoryDisplayDate(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function forgetMemoryMessage(memory: MemoryItem, projectId?: string): string {
  if (memory.scope === 'global' && projectId) {
    return `Forget shared memory "${memory.title}"? This removes it from every project and chat.`;
  }
  return `Forget "${memory.title}"?`;
}

function sourceLabel(source?: string | null): string {
  switch (source) {
    case 'manual': return 'Manual';
    case 'chat_message': return 'Saved chat';
    case 'auto_capture': return 'Auto-captured';
    case 'assistant_tool': return 'Tool saved';
    case 'tool': return 'Tool saved';
    default: return source ? source.replaceAll('_', ' ') : '';
  }
}

function searchableText(item: Pick<MemoryItem | MemoryCandidate, 'title' | 'body' | 'kind' | 'scope' | 'tags' | 'source_type'> & {
  jurisdiction?: string | null;
  as_of_date?: string | null;
}): string {
  return [
    item.title,
    item.body,
    item.kind,
    item.scope,
    sourceLabel(item.source_type),
    item.tags.join(' '),
    item.jurisdiction ?? '',
    item.as_of_date ?? '',
  ].join(' ').toLowerCase();
}

type MemoryEmptyStateProps = {
  colors: ReturnType<typeof useTheme>['colors'];
  hasActiveFilters: boolean;
  hasAnyItems: boolean;
  styles: ReturnType<typeof createStyles>;
};

const MemoryEmptyState: React.FC<MemoryEmptyStateProps> = ({ colors, hasActiveFilters, hasAnyItems, styles }) => {
  const title = hasActiveFilters && hasAnyItems ? 'No matching memories' : 'No memories yet';
  const subtitle = hasActiveFilters
    ? 'Try another search or filter.'
    : 'Save useful chat messages so local models can recall them later.';

  return (
    <View style={styles.emptyInline}>
      <Icon name="bookmark" size={40} color={colors.textMuted} />
      <Text style={styles.emptyText}>{title}</Text>
      <Text style={styles.emptySubtext}>{subtitle}</Text>
    </View>
  );
};

export const MemoryScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const projectId = route.params?.projectId;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const project = useProjectStore((s) => projectId ? s.getProject(projectId) : null);
  const autoCaptureEnabled = useAppStore((s) => s.settings.memoryAutoCaptureEnabled);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [candidates, setCandidates] = useState<MemoryCandidate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyCandidateId, setBusyCandidateId] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const [scopeFilter, setScopeFilter] = useState<MemoryScopeFilter>('all');
  const normalizedSearch = searchText.trim().toLowerCase();
  const hasActiveFilters = normalizedSearch.length > 0 || (!!projectId && scopeFilter !== 'all');
  const matchesFilters = useCallback((item: MemoryItem | MemoryCandidate) => {
    if (projectId && scopeFilter !== 'all' && item.scope !== scopeFilter) return false;
    if (!normalizedSearch) return true;
    return searchableText(item).includes(normalizedSearch);
  }, [normalizedSearch, projectId, scopeFilter]);

  const filteredMemories = useMemo(
    () => memories.filter(matchesFilters),
    [matchesFilters, memories],
  );
  const filteredCandidates = useMemo(
    () => candidates.filter(matchesFilters),
    [candidates, matchesFilters],
  );

  const loadMemories = useCallback(async () => {
    try {
      setIsLoading(true);
      const [nextMemories, nextCandidates] = await Promise.all([
        memoryService.listMemories(projectId),
        memoryService.listPendingCandidates(projectId),
      ]);
      setMemories(nextMemories);
      setCandidates(nextCandidates);
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to load memories');
    } finally {
      setIsLoading(false);
    }
  }, [projectId]);

  useFocusEffect(useCallback(() => {
    loadMemories();
  }, [loadMemories]));

  const handleAddMemory = () => projectId
    ? navigation.navigate('MemoryEditor', { projectId })
    : navigation.navigate('MemoryEditor');

  const handleEditCandidate = (candidate: MemoryCandidate) => {
    const params = projectId
      ? { projectId, candidateId: candidate.id }
      : { candidateId: candidate.id };
    navigation.navigate('MemoryEditor', params);
  };

  const handleDeleteMemory = (memory: MemoryItem) => {
    const isSharedFromProject = memory.scope === 'global' && !!projectId;
    Alert.alert(
      isSharedFromProject ? 'Forget Shared Memory' : 'Forget Memory',
      forgetMemoryMessage(memory, projectId),
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: isSharedFromProject ? 'Forget Everywhere' : 'Forget',
          style: 'destructive',
          onPress: async () => {
            try {
              const deleted = await memoryService.forgetMemory(
                memory.id,
                projectId,
                { allowGlobalFromProject: isSharedFromProject },
              );
              if (!deleted) {
                Alert.alert('Error', 'Memory could not be removed from this context.');
                return;
              }
              await loadMemories();
            } catch (err: any) {
              Alert.alert('Error', err?.message || 'Failed to forget memory');
            }
          },
        },
      ],
    );
  };

  const handleApproveCandidate = async (candidate: MemoryCandidate) => {
    try {
      setBusyCandidateId(candidate.id);
      const saved = await memoryService.approveCandidate(candidate.id, {}, projectId);
      if (!saved) {
        Alert.alert('Error', 'Memory suggestion could not be approved.');
        return;
      }
      await loadMemories();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to approve memory suggestion');
    } finally {
      setBusyCandidateId(null);
    }
  };

  const handleDiscardCandidate = async (candidate: MemoryCandidate) => {
    try {
      setBusyCandidateId(candidate.id);
      const discarded = await memoryService.discardCandidate(candidate.id, projectId);
      if (!discarded) {
        Alert.alert('Error', 'Memory suggestion could not be dismissed.');
        return;
      }
      await loadMemories();
    } catch (err: any) {
      Alert.alert('Error', err?.message || 'Failed to dismiss memory suggestion');
    } finally {
      setBusyCandidateId(null);
    }
  };

  const renderCandidate = (candidate: MemoryCandidate) => {
    const isBusy = busyCandidateId === candidate.id;
    const candidateContext = [
      sourceLabel(candidate.source_type),
      kindLabel(candidate.kind),
      candidate.jurisdiction,
      candidate.as_of_date ? `as of ${formatDate(candidate.as_of_date)}` : '',
      candidate.tags.length ? candidate.tags.join(', ') : '',
    ].filter(Boolean).join(' - ');

    return (
      <View key={candidate.id} style={styles.candidateRow}>
        <View style={styles.candidateIcon}>
          <Icon name="inbox" size={15} color={colors.primary} />
        </View>
        <View style={styles.candidateInfo}>
          <View style={styles.memoryHeader}>
            <Text style={styles.memoryTitle} numberOfLines={1}>{candidate.title}</Text>
            <Text style={styles.memoryScope}>{candidate.scope === 'project' ? 'Project' : 'Shared'}</Text>
          </View>
          <Text style={styles.memoryBody} numberOfLines={2}>{candidate.body}</Text>
          {!!candidateContext && <Text style={styles.memoryMeta} numberOfLines={1}>{candidateContext}</Text>}
          <View style={styles.candidateActions}>
            <TouchableOpacity
              testID={`memory-candidate-discard-${candidate.id}`}
              style={[styles.candidateActionButton, styles.candidateDismissButton]}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Dismiss memory suggestion ${candidate.title}`}
              accessibilityState={{ disabled: isBusy }}
              onPress={() => handleDiscardCandidate(candidate)}
            >
              <Icon name="x" size={14} color={colors.textMuted} />
              <Text style={styles.candidateDismissText}>Dismiss</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={`memory-candidate-edit-${candidate.id}`}
              style={[styles.candidateActionButton, styles.candidateEditButton]}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Edit memory suggestion ${candidate.title}`}
              accessibilityState={{ disabled: isBusy }}
              onPress={() => handleEditCandidate(candidate)}
            >
              <Icon name="edit-2" size={14} color={colors.primary} />
              <Text style={styles.candidateEditText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              testID={`memory-candidate-approve-${candidate.id}`}
              style={[styles.candidateActionButton, styles.candidateApproveButton]}
              disabled={isBusy}
              accessibilityRole="button"
              accessibilityLabel={`Save memory suggestion ${candidate.title}`}
              accessibilityState={{ disabled: isBusy }}
              onPress={() => handleApproveCandidate(candidate)}
            >
              <Icon name="check" size={14} color={colors.surface} />
              <Text style={styles.candidateApproveText}>Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  const renderScopeFilter = () => {
    if (!projectId) return null;
    return (
      <View style={styles.scopeFilterRow}>
        {SCOPE_FILTERS.map(filter => {
          const selected = scopeFilter === filter.value;
          return (
            <TouchableOpacity
              key={filter.value}
              testID={`memory-filter-${filter.value}`}
              style={[styles.scopeFilterButton, selected && styles.scopeFilterButtonActive]}
              accessibilityRole="button"
              accessibilityLabel={`Show ${filter.label.toLowerCase()} memories`}
              accessibilityState={{ selected }}
              onPress={() => setScopeFilter(filter.value)}
            >
              <Text style={[styles.scopeFilterText, selected && styles.scopeFilterTextActive]}>
                {filter.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  };

  const renderListHeader = () => (
    <View>
      <View style={styles.capturePanel}>
        <View style={styles.captureIcon}>
          <Icon name="cpu" size={16} color={colors.primary} />
        </View>
        <View style={styles.captureText}>
          <Text style={styles.captureTitle}>Auto-memory suggestions</Text>
          <Text style={styles.captureSubtitle}>Drafts local chat memories for review. Nothing is used until you save it.</Text>
        </View>
        <Switch
          testID="memory-auto-capture-toggle"
          value={autoCaptureEnabled}
          onValueChange={(value) => updateSettings({ memoryAutoCaptureEnabled: value })}
          trackColor={{ false: colors.border, true: colors.primary }}
          thumbColor={colors.surface}
        />
      </View>
      <View style={styles.controlsPanel}>
        <View style={styles.searchRow}>
          <Icon name="search" size={16} color={colors.textMuted} />
          <TextInput
            testID="memory-search-input"
            accessibilityLabel="Search memories"
            style={styles.searchInput}
            value={searchText}
            onChangeText={setSearchText}
            placeholder="Search memories"
            placeholderTextColor={colors.textMuted}
          />
        </View>
        {renderScopeFilter()}
      </View>
      {filteredCandidates.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Review Suggestions</Text>
          {filteredCandidates.map(renderCandidate)}
        </View>
      )}
      {filteredMemories.length > 0 && <Text style={styles.sectionTitleStandalone}>Saved Memories</Text>}
    </View>
  );

  const renderMemory = ({ item }: { item: MemoryItem }) => {
    const context = [
      kindLabel(item.kind),
      sourceLabel(item.source_type),
      item.jurisdiction,
      item.as_of_date ? `as of ${formatDate(item.as_of_date)}` : '',
      item.tags.length ? item.tags.join(', ') : '',
    ].filter(Boolean).join(' - ');

    return (
      <View style={styles.memoryRow}>
        <View style={styles.memoryIcon}>
          <Icon name="bookmark" size={15} color={colors.textMuted} />
        </View>
        <View style={styles.memoryInfo}>
          <View style={styles.memoryHeader}>
            <Text style={styles.memoryTitle} numberOfLines={1}>{item.title}</Text>
            <Text style={styles.memoryScope}>{item.scope === 'project' ? 'Project' : 'Shared'}</Text>
          </View>
          <Text style={styles.memoryBody} numberOfLines={2}>{item.body}</Text>
          {!!context && <Text style={styles.memoryMeta} numberOfLines={1}>{context}</Text>}
        </View>
        <TouchableOpacity
          testID={`memory-delete-${item.id}`}
          style={styles.deleteButton}
          accessibilityRole="button"
          accessibilityLabel={`Forget memory ${item.title}`}
          onPress={() => handleDeleteMemory(item)}
        >
          <Icon name="trash-2" size={16} color={colors.error} />
        </TouchableOpacity>
      </View>
    );
  };

  const renderEmpty = () => filteredCandidates.length > 0 ? null : (
    <MemoryEmptyState
      colors={colors}
      hasActiveFilters={hasActiveFilters}
      hasAnyItems={memories.length > 0 || candidates.length > 0}
      styles={styles}
    />
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {project?.name ? `${project.name} Memory` : 'Memory'}
          </Text>
        </View>
        <TouchableOpacity
          testID="memory-add"
          onPress={handleAddMemory}
          style={styles.addButton}
          accessibilityRole="button"
          accessibilityLabel="Add memory"
        >
          <Icon name="plus" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredMemories}
          renderItem={renderMemory}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={renderListHeader()}
          ListEmptyComponent={renderEmpty}
          showsVerticalScrollIndicator={false}
        />
      )}
    </SafeAreaView>
  );
};
