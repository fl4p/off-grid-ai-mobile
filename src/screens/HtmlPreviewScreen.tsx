/**
 * HtmlPreviewScreen
 *
 * Renders a single HTML file from the Python workspace in an isolated WebView, so
 * a page the agent wrote (e.g. a self-contained minigame) can actually run on the
 * device instead of only being exported as a .zip. The file content is read live
 * from the interpreter's MEMFS via pythonRuntimeService.readWorkspaceFile, so it
 * reflects the latest write/edit.
 *
 * The WebView is a sandbox: JavaScript and DOM storage are on (so a game runs and
 * can keep state), but nothing bridges back to the app - there is no onMessage
 * handler and no injected script. Top-frame navigation to a remote origin is
 * blocked so generated HTML can not redirect the page off-device.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WebView, type WebViewProps } from 'react-native-webview';
import Icon from 'react-native-vector-icons/Feather';
import { useTheme, useThemedStyles } from '../theme';
import type { ThemeColors, ThemeShadows } from '../theme';
import { TYPOGRAPHY, SPACING } from '../constants';
import { pythonRuntimeService } from '../services/python/pythonRuntimeService';
import { RootStackParamList } from '../navigation/types';
import logger from '../utils/logger';

type NavigationProp = NativeStackNavigationProp<RootStackParamList>;
type RouteProps = RouteProp<RootStackParamList, 'HtmlPreview'>;

// react-native-webview's class-component types don't resolve under React 19's JSX
// checker (props collapse to never) - re-type it with the props we use. Mirrors
// the workaround in PythonRuntimeHost.
const RNWebView = WebView as unknown as React.FC<WebViewProps>;

/** Allow the initial in-memory document to load, block navigation to a remote origin. */
const isLocalDocument = (url: string): boolean =>
  url === 'about:blank' || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('file:');

export const HtmlPreviewScreen: React.FC = () => {
  const navigation = useNavigation<NavigationProp>();
  const route = useRoute<RouteProps>();
  const { path, projectId, title } = route.params;
  const { colors } = useTheme();
  const styles = useThemedStyles(createStyles);

  const [html, setHtml] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumping the key remounts the WebView, restarting the loaded page (a "reload"
  // for the running game) without re-reading the file.
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const content = await pythonRuntimeService.readWorkspaceFile(path, projectId);
      setHtml(content);
    } catch (err: any) {
      logger.warn('[HtmlPreview] Failed to read workspace file:', err);
      const msg = String(err?.message || err);
      setError(
        /not installed/i.test(msg)
          ? 'The Python runtime is not ready. Enable it in Settings > Tools, then reopen this page.'
          : `Could not open the file: ${msg}`,
      );
    } finally {
      setIsLoading(false);
    }
  }, [path, projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const fileName = title || path;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.iconButton} testID="html-preview-back">
          <Icon name="arrow-left" size={20} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Text style={styles.headerTitle} numberOfLines={1}>{fileName}</Text>
          <Text style={styles.headerSubtitle}>Runs on your device, offline</Text>
        </View>
        {html !== null && !error && (
          <TouchableOpacity
            onPress={() => setReloadKey((k) => k + 1)}
            style={styles.iconButton}
            testID="html-preview-reload"
          >
            <Icon name="refresh-cw" size={18} color={colors.text} />
          </TouchableOpacity>
        )}
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={styles.emptyText}>Loading page...</Text>
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Icon name="alert-circle" size={40} color={colors.error} />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={load} style={styles.retryButton} testID="html-preview-retry">
            <Text style={styles.retryText}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : html !== null ? (
        <RNWebView
          key={reloadKey}
          testID="html-preview-webview"
          source={{ html }}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          setSupportMultipleWindows={false}
          onShouldStartLoadWithRequest={(req: { url: string }) => isLocalDocument(req.url)}
          style={styles.webview}
        />
      ) : (
        <View style={styles.centered}>
          <Icon name="file" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>Nothing to show</Text>
        </View>
      )}
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
  },
  iconButton: {
    padding: SPACING.xs,
  },
  headerCenter: {
    flex: 1,
    marginHorizontal: SPACING.md,
  },
  headerTitle: {
    ...TYPOGRAPHY.h2,
    color: colors.text,
    fontWeight: '400' as const,
  },
  headerSubtitle: {
    ...TYPOGRAPHY.labelSmall,
    color: colors.textMuted,
    marginTop: 2,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    paddingHorizontal: SPACING.xxl,
  },
  errorText: {
    ...TYPOGRAPHY.body,
    color: colors.error,
    textAlign: 'center' as const,
    marginTop: SPACING.md,
  },
  emptyText: {
    ...TYPOGRAPHY.body,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: SPACING.md,
  },
  retryButton: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: SPACING.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  retryText: {
    ...TYPOGRAPHY.body,
    color: colors.primary,
  },
});
