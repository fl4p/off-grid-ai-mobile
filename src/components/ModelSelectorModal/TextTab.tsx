import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../../theme';
import { DownloadedModel, RemoteModel } from '../../types';
import { hardwareService } from '../../services';
import { RemoteToolsToggle } from '../RemoteToolsToggle';
import { createAllStyles } from './styles';

export interface TextTabProps {
  downloadedModels: DownloadedModel[];
  remoteModels: Array<{ serverId: string; serverName: string; models: RemoteModel[] }>;
  currentModelPath: string | null;
  currentRemoteServerId?: string | null;
  currentRemoteModelId: string | null;
  recentTextModelKeys?: string[];
  favoriteTextModelKeys?: string[];
  isAnyLoading: boolean;
  onSelectModel: (model: DownloadedModel) => void;
  onSelectRemoteModel: (model: RemoteModel, serverId: string) => void;
  onToggleFavoriteTextModel?: (modelKey: string) => void;
  onUnloadModel: () => void;
  onAddServer: () => void;
  onBrowseModels?: () => void;
}

type TextModelEntry =
  | { key: string; type: 'local'; model: DownloadedModel }
  | { key: string; type: 'remote'; model: RemoteModel; serverId: string; serverName: string };

const localTextModelKey = (modelId: string) => `local:${modelId}`;
const remoteTextModelKey = (serverId: string, modelId: string) => `remote:${serverId}:${modelId}`;

function orderByKeys(entries: TextModelEntry[], keys: string[]): TextModelEntry[] {
  const byKey = new Map(entries.map(entry => [entry.key, entry]));
  return keys.map(key => byKey.get(key)).filter((entry): entry is TextModelEntry => !!entry);
}

export const TextTab: React.FC<TextTabProps> = ({
  downloadedModels, remoteModels, currentModelPath, currentRemoteServerId = null, currentRemoteModelId, recentTextModelKeys = [], favoriteTextModelKeys = [], isAnyLoading, onSelectModel, onUnloadModel, onSelectRemoteModel, onToggleFavoriteTextModel, onAddServer, onBrowseModels,
}) => {
  const { colors } = useTheme();
  const styles = useThemedStyles(createAllStyles);
  const hasLoaded = currentModelPath !== null || currentRemoteModelId !== null;
  const activeLocalModel = downloadedModels.find(m => m.filePath === currentModelPath);

  // Find active remote model info
  const activeRemoteModelInfo = useMemo(() => {
    if (!currentRemoteModelId) return null;
    for (const group of remoteModels) {
      if (currentRemoteServerId && group.serverId !== currentRemoteServerId) continue;
      const model = group.models.find(m => m.id === currentRemoteModelId);
      if (model) return { model, serverName: group.serverName };
    }
    return null;
  }, [remoteModels, currentRemoteServerId, currentRemoteModelId]);

  const allTextEntries = useMemo<TextModelEntry[]>(() => [
    ...downloadedModels.map(model => ({
      key: localTextModelKey(model.id),
      type: 'local' as const,
      model,
    })),
    ...remoteModels.flatMap(group => group.models.map(model => ({
      key: remoteTextModelKey(group.serverId, model.id),
      type: 'remote' as const,
      model,
      serverId: group.serverId,
      serverName: group.serverName,
    }))),
  ], [downloadedModels, remoteModels]);

  const favoriteEntries = useMemo(
    () => orderByKeys(allTextEntries, favoriteTextModelKeys),
    [allTextEntries, favoriteTextModelKeys],
  );
  const recentEntries = useMemo(
    () => orderByKeys(allTextEntries, recentTextModelKeys).filter(entry => !favoriteTextModelKeys.includes(entry.key)),
    [allTextEntries, recentTextModelKeys, favoriteTextModelKeys],
  );

  const renderTextModelRow = (
    entry: TextModelEntry,
    options: { keyPrefix?: string; showServerName?: boolean; selectedStyle?: object; selectedNameStyle?: object; checkmarkStyle?: object } = {},
  ) => {
    const isLocal = entry.type === 'local';
    const isCurrent = isLocal
      ? currentModelPath === entry.model.filePath
      : currentRemoteServerId === entry.serverId && currentRemoteModelId === entry.model.id;
    const isFavorite = favoriteTextModelKeys.includes(entry.key);
    return (
      <TouchableOpacity
        key={`${options.keyPrefix ?? 'model'}:${entry.key}`}
        accessibilityRole="button"
        accessibilityLabel={`Select ${entry.model.name}`}
        style={[styles.modelItem, isCurrent && (options.selectedStyle ?? styles.modelItemSelected)]}
        onPress={() => {
          if (isLocal) onSelectModel(entry.model);
          else onSelectRemoteModel(entry.model, entry.serverId);
        }}
        disabled={isAnyLoading || isCurrent}
      >
        <View style={styles.modelInfo}>
          <Text style={[styles.modelName, isCurrent && (options.selectedNameStyle ?? styles.modelNameSelected)]} numberOfLines={1}>
            {entry.model.name}
          </Text>
          <View style={styles.modelMeta}>
            {entry.type === 'local' ? (
              <>
                <Text style={styles.modelSize}>{hardwareService.formatModelSize(entry.model)}</Text>
                {!!entry.model.quantization && (
                  <>
                    <Text style={styles.metaSeparator}>•</Text>
                    <Text style={styles.modelQuant}>{entry.model.quantization}</Text>
                  </>
                )}
                {entry.model.engine === 'llama' && entry.model.isVisionModel && (
                  <>
                    <Text style={styles.metaSeparator}>•</Text>
                    <View style={styles.visionBadge}>
                      <Icon name="eye" size={10} color={colors.info} />
                      <Text style={styles.visionBadgeText}>Vision</Text>
                    </View>
                  </>
                )}
              </>
            ) : (
              <>
                <Text style={styles.remoteBadge}>Remote</Text>
                {options.showServerName && (
                  <>
                    <Text style={styles.metaSeparator}>•</Text>
                    <Text style={styles.modelQuant}>{entry.serverName}</Text>
                  </>
                )}
                {entry.model.capabilities.supportsVision && (
                  <>
                    <Text style={styles.metaSeparator}>•</Text>
                    <View style={styles.visionBadge}>
                      <Icon name="eye" size={10} color={colors.info} />
                      <Text style={styles.visionBadgeText}>Vision</Text>
                    </View>
                  </>
                )}
                <Text style={styles.metaSeparator}>•</Text>
                <RemoteToolsToggle model={entry.model} />
                {entry.model.capabilities.supportsThinking && (
                  <>
                    <Text style={styles.metaSeparator}>•</Text>
                    <View style={styles.thinkingBadge}>
                      <Icon name="zap" size={10} color="#8B5CF6" />
                      <Text style={styles.thinkingBadgeText}>Thinking</Text>
                    </View>
                  </>
                )}
              </>
            )}
          </View>
        </View>
        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={`${isFavorite ? 'Remove favorite' : 'Add favorite'} ${entry.model.name}`}
          style={localStyles.favoriteButton}
          onPress={(event) => {
            event?.stopPropagation?.();
            onToggleFavoriteTextModel?.(entry.key);
          }}
          disabled={isAnyLoading}
        >
          <Icon name="star" size={18} color={isFavorite ? colors.warning : colors.textMuted} />
        </TouchableOpacity>
        {isCurrent && (
          <View style={[styles.checkmark, options.checkmarkStyle]}>
            <Icon name="check" size={16} color={colors.background} />
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <>
      {hasLoaded && (
        <View style={styles.loadedSection}>
          <View style={styles.loadedHeader}>
            <Icon name="check-circle" size={14} color={colors.success} />
            <Text style={styles.loadedLabel}>Currently Loaded</Text>
          </View>
          <View style={styles.loadedModelItem}>
            <View style={styles.loadedModelInfo}>
              <Text style={styles.loadedModelName} numberOfLines={1}>
                {activeLocalModel?.name || activeRemoteModelInfo?.model?.name || 'Unknown'}
              </Text>
              <Text style={styles.loadedModelMeta}>
                {activeLocalModel
                  ? `${activeLocalModel.quantization} • ${hardwareService.formatModelSize(activeLocalModel)}`
                  : `Remote • ${activeRemoteModelInfo?.serverName ?? 'Model'}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.unloadButton} onPress={onUnloadModel} disabled={isAnyLoading}>
              <Icon name="power" size={16} color={colors.error} />
              <Text style={styles.unloadButtonText}>Unload</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <Text style={styles.sectionTitle}>{hasLoaded ? 'Switch Model' : 'Available Models'}</Text>

      {favoriteEntries.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="star" size={14} color={colors.warning} />
            <Text style={styles.sectionSubTitle}>Favorites</Text>
          </View>
          {favoriteEntries.map(entry => renderTextModelRow(entry, entry.type === 'remote'
            ? { keyPrefix: 'favorite', showServerName: true, selectedStyle: styles.modelItemSelectedRemote, selectedNameStyle: styles.modelNameSelectedRemote, checkmarkStyle: styles.checkmarkRemote }
            : { keyPrefix: 'favorite' }))}
        </>
      )}

      {recentEntries.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="clock" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Recent</Text>
          </View>
          {recentEntries.map(entry => renderTextModelRow(entry, entry.type === 'remote'
            ? { keyPrefix: 'recent', showServerName: true, selectedStyle: styles.modelItemSelectedRemote, selectedNameStyle: styles.modelNameSelectedRemote, checkmarkStyle: styles.checkmarkRemote }
            : { keyPrefix: 'recent' }))}
        </>
      )}

      {/* Empty state when no models at all */}
      {downloadedModels.length === 0 && remoteModels.length === 0 && (
        <View style={styles.emptyState}>
          <Icon name="package" size={40} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Text Models</Text>
          <Text style={styles.emptyText}>Download models from the Models tab</Text>
          <View style={localStyles.emptyActions}>
            <TouchableOpacity style={[localStyles.actionButton, { borderColor: colors.border }]} onPress={onAddServer} disabled={isAnyLoading}>
              <Icon name="wifi" size={14} color={colors.textSecondary} />
              <Text style={[localStyles.actionButtonText, { color: colors.textSecondary }]}>Add Remote Server</Text>
            </TouchableOpacity>
            {onBrowseModels && (
              <TouchableOpacity style={[localStyles.actionButton, { borderColor: colors.primary }]} onPress={onBrowseModels}>
                <Icon name="download" size={14} color={colors.primary} />
                <Text style={[localStyles.actionButtonText, { color: colors.primary }]}>Browse Models</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Local Models Section */}
      {downloadedModels.length > 0 && (
        <>
          <View style={styles.sectionHeaderRow}>
            <Icon name="hard-drive" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>Local Models</Text>
          </View>
          {downloadedModels.map((model) => renderTextModelRow({
            key: localTextModelKey(model.id),
            type: 'local',
            model,
          }))}
        </>
      )}

      {/* Remote Models Sections */}
      {remoteModels.map(({ serverId, serverName, models }) => (
        <View key={serverId}>
          <View style={styles.sectionHeaderRow}>
            <Icon name="wifi" size={14} color={colors.textMuted} />
            <Text style={styles.sectionSubTitle}>{serverName}</Text>
          </View>
          {models.map((model) => renderTextModelRow({
            key: remoteTextModelKey(serverId, model.id),
            type: 'remote',
            model,
            serverId,
            serverName,
          }, {
            keyPrefix: 'remote',
            selectedStyle: styles.modelItemSelectedRemote,
            selectedNameStyle: styles.modelNameSelectedRemote,
            checkmarkStyle: styles.checkmarkRemote,
          }))}
        </View>
      ))}
    </>
  );
};

const localStyles = StyleSheet.create({
  emptyActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
    flexWrap: 'wrap' as const,
    justifyContent: 'center' as const,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '400',
  },
  favoriteButton: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
  },
});
