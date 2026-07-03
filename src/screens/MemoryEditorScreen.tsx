import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import { memoryService, type MemoryCandidate, type MemoryKind } from '../services/memory';
import { RootStackParamList } from '../navigation/types';
import { createStyles } from './MemoryEditorScreen.styles';
import {
  buildMemoryCandidateApprovalInput,
  buildMemoryInput,
  MEMORY_KIND_OPTIONS,
} from './MemoryEditorScreen.form';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'MemoryEditor'>;

export const MemoryEditorScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const projectId = route.params?.projectId;
  const candidateId = route.params?.candidateId;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [kind, setKind] = useState<MemoryKind>('research_note');
  const [tagsText, setTagsText] = useState('');
  const [jurisdiction, setJurisdiction] = useState('');
  const [asOfDate, setAsOfDate] = useState('');
  const [candidate, setCandidate] = useState<MemoryCandidate | null>(null);
  const [isLoadingCandidate, setIsLoadingCandidate] = useState(!!candidateId);
  const [isSaving, setIsSaving] = useState(false);
  const isReviewingCandidate = !!candidateId;
  const effectiveScope = candidate ? candidate.scope : projectId ? 'project' : 'global';
  const scopeLabel = effectiveScope === 'project' ? 'Project Memory' : 'Shared Memory';
  const scopeDescription = effectiveScope === 'project'
    ? 'Only this project can recall this memory.'
    : 'All local chats and projects can recall this memory.';

  useEffect(() => {
    let cancelled = false;
    if (!candidateId) {
      setCandidate(null);
      setIsLoadingCandidate(false);
      return () => { cancelled = true; };
    }

    setIsLoadingCandidate(true);
    memoryService.getCandidate(candidateId, projectId)
      .then((loaded) => {
        if (cancelled) return;
        if (!loaded || loaded.status !== 'pending') {
          Alert.alert('Memory Error', 'Memory suggestion is no longer available.', [
            { text: 'OK', onPress: () => navigation.goBack() },
          ]);
          return;
        }
        setCandidate(loaded);
        setTitle(loaded.title);
        setBody(loaded.body);
        setKind(loaded.kind);
        setTagsText(loaded.tags.join(', '));
        setJurisdiction(loaded.jurisdiction ?? '');
        setAsOfDate(loaded.as_of_date ?? '');
      })
      .catch((err: any) => {
        if (cancelled) return;
        Alert.alert('Memory Error', err?.message || 'Failed to load memory suggestion');
      })
      .finally(() => {
        if (!cancelled) setIsLoadingCandidate(false);
      });

    return () => { cancelled = true; };
  }, [candidateId, navigation, projectId]);

  const handleSave = async () => {
    if (isSaving) return;
    try {
      setIsSaving(true);
      if (isReviewingCandidate) {
        if (!candidate) throw new Error('Memory suggestion is still loading');
        const input = buildMemoryCandidateApprovalInput({ kind, title, body, tagsText, jurisdiction, asOfDate });
        const saved = await memoryService.approveCandidate(candidate.id, input, projectId);
        if (!saved) throw new Error('Memory suggestion is no longer available');
      } else {
        const input = buildMemoryInput({ projectId, kind, title, body, tagsText, jurisdiction, asOfDate });
        await memoryService.saveMemory(input);
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert('Memory Error', err?.message || 'Failed to save memory');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle}>{isReviewingCandidate ? 'Review Memory' : 'Add Memory'}</Text>
        </View>
        <TouchableOpacity
          testID="memory-save"
          style={[styles.saveButton, isSaving && styles.saveButtonDisabled]}
          onPress={handleSave}
          disabled={isSaving || isLoadingCandidate}
        >
          <Text style={styles.saveButtonText}>
            {isSaving ? 'Saving' : isReviewingCandidate ? 'Approve' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {isLoadingCandidate ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
        </View>
      ) : (
        <ScrollView style={styles.container} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.scopeBanner}>
            <Icon name={effectiveScope === 'project' ? 'folder' : 'globe'} size={16} color={colors.primary} />
            <View style={styles.scopeTextContainer}>
              <Text testID="memory-scope-label" style={styles.scopeTitle}>{scopeLabel}</Text>
              <Text style={styles.scopeDescription}>{scopeDescription}</Text>
            </View>
          </View>

          {!!candidate?.source_excerpt && (
            <View style={styles.sourceBanner}>
              <Icon name="message-square" size={16} color={colors.textMuted} />
              <View style={styles.scopeTextContainer}>
                <Text style={styles.sourceTitle}>Suggested from local chat</Text>
                <Text testID="memory-candidate-source" style={styles.sourceExcerpt} numberOfLines={3}>
                  {candidate.source_excerpt}
                </Text>
              </View>
            </View>
          )}

          <View style={styles.field}>
            <Text style={styles.label}>Title</Text>
            <TextInput
              testID="memory-title-input"
              style={styles.input}
              value={title}
              onChangeText={setTitle}
              placeholder="Solar tax credit research"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Memory</Text>
            <TextInput
              testID="memory-body-input"
              style={[styles.input, styles.bodyInput]}
              value={body}
              onChangeText={setBody}
              placeholder="What should the local model remember?"
              placeholderTextColor={colors.textMuted}
              multiline
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Type</Text>
            <View style={styles.kindGrid}>
              {MEMORY_KIND_OPTIONS.map(option => {
                const selected = option.kind === kind;
                return (
                  <TouchableOpacity
                    key={option.kind}
                    testID={`memory-kind-${option.kind}`}
                    style={[styles.kindChip, selected && styles.kindChipActive]}
                    onPress={() => setKind(option.kind)}
                  >
                    <Text style={[styles.kindChipText, selected && styles.kindChipTextActive]}>
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Tags</Text>
            <TextInput
              testID="memory-tags-input"
              style={styles.input}
              value={tagsText}
              onChangeText={setTagsText}
              placeholder="tax, solar, federal"
              placeholderTextColor={colors.textMuted}
            />
            <Text style={styles.helpText}>Separate tags with commas or new lines.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Jurisdiction</Text>
            <TextInput
              testID="memory-jurisdiction-input"
              style={styles.input}
              value={jurisdiction}
              onChangeText={setJurisdiction}
              placeholder="United States, California, Portugal"
              placeholderTextColor={colors.textMuted}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>As Of</Text>
            <TextInput
              testID="memory-as-of-input"
              style={styles.input}
              value={asOfDate}
              onChangeText={setAsOfDate}
              placeholder="2026-07-03"
              placeholderTextColor={colors.textMuted}
            />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
};
