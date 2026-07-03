import React from 'react';
import { StyleSheet, StyleProp, ViewStyle } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2;

type ZoomableImageProps = {
  uri: string;
  /** Sizes the zoom viewport (typically the fullscreen image box). */
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
};

/**
 * Pinch-to-zoom / pan / double-tap image, usable inside a Modal. It carries its
 * own GestureHandlerRootView because RN Modals render in a detached view tree, so
 * the app-root gesture handler does not reach modal content on Android.
 *
 * Zooming past 1x is clamped to MAX_SCALE; releasing below 1x (or a double-tap
 * while zoomed) springs back to fit. Pan only applies while zoomed in.
 */
export function ZoomableImage({ uri, containerStyle, testID }: ZoomableImageProps) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  const pinch = Gesture.Pinch()
    .onUpdate(e => {
      scale.value = Math.min(MAX_SCALE, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(() => {
      if (scale.value <= 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        savedScale.value = scale.value;
      }
    });

  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate(e => {
      if (scale.value > 1) {
        tx.value = savedTx.value + e.translationX;
        ty.value = savedTy.value + e.translationY;
      }
    })
    .onEnd(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        savedScale.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
        savedTx.value = 0;
        savedTy.value = 0;
      } else {
        scale.value = withTiming(DOUBLE_TAP_SCALE);
        savedScale.value = DOUBLE_TAP_SCALE;
      }
    });

  const composed = Gesture.Simultaneous(pinch, pan, doubleTap);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureHandlerRootView style={[styles.root, containerStyle]}>
      <GestureDetector gesture={composed}>
        <Animated.Image
          testID={testID}
          source={{ uri }}
          style={[styles.image, animatedStyle]}
          resizeMode="contain"
        />
      </GestureDetector>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
