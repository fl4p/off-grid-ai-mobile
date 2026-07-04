/**
 * AnimatedToggle
 *
 * A themed on/off switch with a thumb that slides between states and a track
 * that cross-fades border -> primary. Built on the Animated API (not the native
 * Switch) so the slide/colour transition is identical on iOS and Android and
 * uses design-system colour tokens. Drop-in for a controlled boolean control.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme';

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB_SIZE = 22;
const PADDING = 3;
const TRAVEL = TRACK_WIDTH - THUMB_SIZE - PADDING * 2;

interface AnimatedToggleProps {
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

export const AnimatedToggle: React.FC<AnimatedToggleProps> = ({
  value,
  onValueChange,
  disabled,
  testID,
  accessibilityLabel,
}) => {
  const { colors } = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [value, anim]);

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });
  const translateX = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, TRAVEL],
  });

  return (
    <Pressable
      onPress={() => !disabled && onValueChange(!value)}
      disabled={disabled}
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: !!disabled }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      style={disabled ? styles.disabled : undefined}
    >
      <Animated.View style={[styles.track, { backgroundColor: trackColor }]}>
        <Animated.View
          style={[
            styles.thumb,
            // A subtle border (not boxShadow) gives the thumb contrast against
            // the low-contrast "off" track. boxShadow on an Animated.View that
            // also has an interpolated transform crashes Android's New Arch, so
            // keep any decoration to plain border/background props here.
            { backgroundColor: colors.background, borderColor: colors.borderLight, transform: [{ translateX }] },
          ]}
        />
      </Animated.View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: PADDING,
    justifyContent: 'center',
  },
  thumb: {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  disabled: {
    opacity: 0.5,
  },
});
