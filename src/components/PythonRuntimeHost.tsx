/**
 * PythonRuntimeHost
 *
 * Invisible WebView that hosts the Pyodide interpreter for the run_python
 * tool. Mounted once at the app root; renders nothing until the runtime is
 * installed and an execution has been requested (pythonRuntimeService sets
 * executorRequested on first use), then stays warm so interpreter state and
 * loaded packages persist across tool calls.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewProps } from 'react-native-webview';
import { pythonRuntimeService } from '../services/python/pythonRuntimeService';
import { usePythonRuntimeStore } from '../stores/pythonRuntimeStore';
import { PYTHON_PAGE_FILE } from '../services/python/pyodideManifest';

interface WebViewHandle {
  injectJavaScript: (js: string) => void;
}

// react-native-webview's class component types don't resolve under React 19's
// JSX checker (props collapse to never) — re-type it with the props we use.
const RNWebView = WebView as unknown as React.FC<
  WebViewProps & { ref?: React.Ref<WebViewHandle> }
>;

export const PythonRuntimeHost: React.FC = () => {
  const status = usePythonRuntimeStore((s) => s.status);
  const executorRequested = usePythonRuntimeStore((s) => s.executorRequested);
  const serverOrigin = usePythonRuntimeStore((s) => s.serverOrigin);
  const webViewRef = useRef<WebViewHandle>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const active = executorRequested && status === 'installed' && !!serverOrigin;

  useEffect(() => {
    if (!active) return;
    pythonRuntimeService.registerExecutor({
      inject: (js) => webViewRef.current?.injectJavaScript(js),
      reload: () => setReloadKey((k) => k + 1),
    });
    return () => pythonRuntimeService.unregisterExecutor();
  }, [active]);

  if (!active) return null;

  return (
    <View style={styles.hidden} pointerEvents="none" testID="python-runtime-host">
      <RNWebView
        key={reloadKey}
        ref={webViewRef}
        source={{ uri: `${serverOrigin}/${PYTHON_PAGE_FILE}` }}
        onMessage={(event: { nativeEvent: { data: string } }) => pythonRuntimeService.handleWebViewMessage(event.nativeEvent.data)}
        originWhitelist={['*']}
        javaScriptEnabled
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
        testID="python-runtime-webview"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
    overflow: 'hidden',
  },
});
