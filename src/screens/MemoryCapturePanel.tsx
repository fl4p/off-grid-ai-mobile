import React from 'react';
import { Switch, Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import type { ThemeColors } from '../theme';
import type { createStyles } from './MemoryScreen.styles';

type MemoryCapturePanelProps = {
  autoCaptureEnabled: boolean;
  autoSaveEnabled: boolean;
  colors: ThemeColors;
  styles: ReturnType<typeof createStyles>;
  updateSettings: (settings: {
    memoryAutoCaptureEnabled?: boolean;
    memoryAutoSaveEnabled?: boolean;
  }) => void;
};

export const MemoryCapturePanel: React.FC<MemoryCapturePanelProps> = ({
  autoCaptureEnabled,
  autoSaveEnabled,
  colors,
  styles,
  updateSettings,
}) => (
  <View style={styles.capturePanel}>
    <View style={styles.captureRow}>
      <View style={styles.captureIcon}>
        <Icon name="cpu" size={16} color={colors.primary} />
      </View>
      <View style={styles.captureText}>
        <Text style={styles.captureTitle}>Auto-memory capture</Text>
        <Text style={styles.captureSubtitle}>Extracts local chat memories. Save automatically controls whether you review them first.</Text>
      </View>
      <Switch
        testID="memory-auto-capture-toggle"
        accessibilityLabel="Auto-memory capture"
        accessibilityState={{ checked: autoCaptureEnabled }}
        value={autoCaptureEnabled}
        onValueChange={(value) => updateSettings({ memoryAutoCaptureEnabled: value })}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
      />
    </View>
    <View style={[
      styles.captureRow,
      styles.captureNestedRow,
      !autoCaptureEnabled && styles.captureRowDisabled,
    ]}>
      <View style={styles.captureIcon}>
        <Icon name="zap" size={16} color={autoCaptureEnabled ? colors.primary : colors.textMuted} />
      </View>
      <View style={styles.captureText}>
        <Text style={styles.captureTitle}>Save automatically</Text>
        <Text style={styles.captureSubtitle}>Save extracted memories immediately instead of adding them to Review Suggestions.</Text>
      </View>
      <Switch
        testID="memory-auto-save-toggle"
        accessibilityLabel="Save memories automatically"
        accessibilityState={{
          checked: autoCaptureEnabled && autoSaveEnabled,
          disabled: !autoCaptureEnabled,
        }}
        value={autoCaptureEnabled && autoSaveEnabled}
        disabled={!autoCaptureEnabled}
        onValueChange={(value) => updateSettings({ memoryAutoSaveEnabled: value })}
        trackColor={{ false: colors.border, true: colors.primary }}
        thumbColor={colors.surface}
      />
    </View>
  </View>
);
