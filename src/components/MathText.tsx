import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MathJax from 'react-native-mathjax-svg';
import { FONTS } from '../constants';

const styles = StyleSheet.create({
  block: { alignItems: 'center', paddingVertical: 6, width: '100%' },
});

interface MathTextProps {
  /** Raw TeX source, without the `$`/`$$` delimiters. */
  tex: string;
  color: string;
  /** Base font size in px; the glyph height scales from this. */
  fontSize: number;
  /** Block math ($$…$$) renders centered on its own line. */
  block?: boolean;
}

interface BoundaryProps {
  fallback: React.ReactNode;
  children: React.ReactNode;
}

/**
 * MathJax throws (rather than returning) on malformed TeX — e.g. an unbalanced
 * `\frac` or an unknown macro produces an SVG with no dimensions and the sizing
 * code dereferences null. Catch that and fall back to the raw source so a bad
 * formula degrades to readable text instead of crashing the whole message.
 */
class MathErrorBoundary extends React.Component<BoundaryProps, { hasError: boolean }> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) return this.props.fallback;
    return this.props.children;
  }
}

export function MathText({ tex, color, fontSize, block }: Readonly<MathTextProps>) {
  const trimmed = tex.trim();
  const fallback = (
    <Text style={{ fontFamily: FONTS.mono, color, fontSize: fontSize - 1 }}>
      {block ? `$$${trimmed}$$` : `$${trimmed}$`}
    </Text>
  );

  if (!trimmed) return null;

  const math = (
    <MathErrorBoundary fallback={fallback}>
      <MathJax color={color} fontSize={fontSize}>
        {trimmed}
      </MathJax>
    </MathErrorBoundary>
  );

  // Block math gets its own centered row; inline math sits in the text flow.
  return block ? <View style={styles.block}>{math}</View> : math;
}

export default MathText;
