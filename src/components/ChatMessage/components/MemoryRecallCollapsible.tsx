import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { MemoryRecallSummary } from '../../../services/memory';

interface MemoryRecallCollapsibleProps {
  memories: MemoryRecallSummary[];
  styles: any;
  colors: any;
}

function formatSource(sourceType: string): string {
  switch (sourceType) {
    case 'auto_capture': return 'Auto-captured';
    case 'chat_message': return 'Saved chat';
    case 'tool': return 'Tool saved';
    case 'manual':
    default: return 'Manual';
  }
}

function formatMemoryDetail(memory: MemoryRecallSummary): string {
  return [
    memory.scope === 'project' ? 'Project' : 'Global',
    memory.kind.replace(/_/g, ' '),
    formatSource(memory.sourceType),
    memory.jurisdiction,
    memory.asOfDate ? `as of ${memory.asOfDate}` : undefined,
    memory.reason,
  ].filter(Boolean).join(' | ');
}

export const MemoryRecallCollapsible: React.FC<MemoryRecallCollapsibleProps> = ({ memories, styles, colors }) => {
  const [expanded, setExpanded] = useState(false);
  if (!memories.length) return null;
  return (
    <View testID="memory-recall-collapsible" style={styles.systemInfoContainer}>
      <TouchableOpacity style={styles.toolStatusRow} onPress={() => setExpanded(!expanded)} activeOpacity={0.6}>
        <Icon name="bookmark" size={13} color={colors.textMuted} />
        <Text style={styles.toolStatusText} numberOfLines={1}>
          Memories used ({memories.length})
        </Text>
        <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
      </TouchableOpacity>
      {!!expanded && (
        <View style={styles.toolDetailContainer}>
          {memories.map(memory => (
            <View key={memory.id} testID={`memory-recall-${memory.id}`} style={styles.memoryRecallItem}>
              <Text style={styles.toolStatusText} numberOfLines={2}>
                {`Memory #${memory.id}`}
              </Text>
              <Text style={styles.memoryRecallMetaText} numberOfLines={2}>
                {formatMemoryDetail(memory)}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};
