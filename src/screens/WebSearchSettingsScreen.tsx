import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Feather';
import { useNavigation } from '@react-navigation/native';
import { ApiKeyInput, Card } from '../components';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { useAppStore } from '../stores';
import { SEARCH_PROVIDER_OPTIONS } from '../services/tools/search';
import { getSearchApiKey, storeSearchApiKey } from '../services/tools/search/searchKeychain';

export const WebSearchSettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const searchProvider = useAppStore(s => s.settings.searchProvider);
  const updateSettings = useAppStore(s => s.updateSettings);

  const selectedOption = SEARCH_PROVIDER_OPTIONS.find(o => o.id === searchProvider);
  const needsKey = selectedOption?.requiresApiKey ?? false;

  // The key lives in the keychain, not settings — mirror it into local state.
  const [apiKey, setApiKey] = useState('');
  useEffect(() => {
    let active = true;
    if (!needsKey) { setApiKey(''); return; }
    getSearchApiKey(searchProvider).then(key => { if (active) setApiKey(key); });
    return () => { active = false; };
  }, [searchProvider, needsKey]);

  const onChangeKey = (text: string) => {
    setApiKey(text);
    storeSearchApiKey(searchProvider, text).catch(() => {});
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <Text style={styles.title}>Web Search</Text>
      </View>

      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        <Card style={styles.section}>
          <Text style={styles.sectionTitle}>Search Provider</Text>
          {SEARCH_PROVIDER_OPTIONS.map((option, index) => {
            const selected = option.id === searchProvider;
            return (
              <TouchableOpacity
                key={option.id}
                testID={`search-provider-${option.id}`}
                style={[styles.optionRow, index === 0 && styles.optionRowFirst]}
                onPress={() => updateSettings({ searchProvider: option.id })}
              >
                <View style={styles.settingInfo}>
                  <Text style={styles.settingLabel}>{option.label}</Text>
                  <Text style={styles.settingHint}>
                    {option.requiresApiKey
                      ? 'Sends your query to serper.dev with your API key. Requires a key.'
                      : 'Runs on your device against Brave. No API key, no third-party proxy.'}
                  </Text>
                </View>
                <Icon
                  name={selected ? 'check-circle' : 'circle'}
                  size={20}
                  color={selected ? colors.primary : colors.textMuted}
                />
              </TouchableOpacity>
            );
          })}
        </Card>

        {needsKey && (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>{selectedOption?.label} API Key</Text>
            <ApiKeyInput
              testID="search-api-key-input"
              value={apiKey}
              onChangeText={onChangeKey}
              placeholder="Paste your API key"
              placeholderTextColor={colors.textMuted}
              iconColor={colors.textMuted}
              containerStyle={styles.apiKeyContainer}
              inputStyle={styles.apiKeyInput}
              toggleStyle={styles.apiKeyToggle}
            />
            {apiKey.trim() ? (
              <Text style={styles.settingHint}>
                Stored on device in the keychain. Sent only to serper.dev when searching.
              </Text>
            ) : (
              <View style={styles.warningRow}>
                <Icon name="alert-circle" size={14} color={colors.textMuted} />
                <Text style={styles.warningText}>
                  No key set, so searches fall back to on-device Brave until you add one.
                </Text>
              </View>
            )}
          </Card>
        )}

        <Card style={styles.infoCard}>
          <Icon name="info" size={18} color={colors.textMuted} />
          <Text style={styles.infoText}>
            Brave runs the search on your device, so no query leaves for a third-party service. Serper returns Google results, including answer boxes, but sends each query to serper.dev.
          </Text>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
};

const createStyles = (colors: ThemeColors, shadows: ThemeShadows) => ({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    ...shadows.small,
    zIndex: 1,
    gap: SPACING.md,
  },
  backButton: {
    padding: SPACING.xs,
  },
  title: {
    ...TYPOGRAPHY.h2,
    flex: 1,
    color: colors.text,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  section: {
    marginBottom: SPACING.lg,
  },
  sectionTitle: {
    ...TYPOGRAPHY.label,
    textTransform: 'uppercase' as const,
    color: colors.textMuted,
    marginBottom: SPACING.md,
    letterSpacing: 0.3,
  },
  optionRow: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    gap: SPACING.md,
  },
  optionRowFirst: {
    paddingTop: 0,
    borderTopWidth: 0,
  },
  settingInfo: {
    flex: 1,
  },
  settingLabel: {
    ...TYPOGRAPHY.body,
    color: colors.text,
  },
  settingHint: {
    ...TYPOGRAPHY.bodySmall,
    color: colors.textMuted,
    marginTop: 2,
    lineHeight: 18,
  },
  apiKeyContainer: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: SPACING.sm,
    backgroundColor: colors.background,
    marginBottom: SPACING.sm,
  },
  apiKeyInput: {
    ...TYPOGRAPHY.body,
    flex: 1,
    color: colors.text,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  apiKeyToggle: {
    padding: SPACING.md,
  },
  warningRow: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    gap: SPACING.xs,
  },
  warningText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
  infoCard: {
    flexDirection: 'row' as const,
    alignItems: 'flex-start' as const,
    gap: SPACING.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  infoText: {
    ...TYPOGRAPHY.bodySmall,
    flex: 1,
    color: colors.textMuted,
    lineHeight: 18,
  },
});
