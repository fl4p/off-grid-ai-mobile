import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  Image,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from 'react-native-reanimated';
import Icon from 'react-native-vector-icons/Feather';
import { MediaAttachment } from '../../../types';
import { viewDocument } from '@react-native-documents/viewer';
import logger from '../../../utils/logger';

interface FadeInImageProps {
  uri: string;
  imageStyle: any;
  testID?: string;
  wrapperTestID?: string;
  onPress?: () => void;
}

function FadeInImage({ uri, imageStyle, testID, wrapperTestID, onPress }: FadeInImageProps) {
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return (
    <Animated.View style={[fadeInImageStyles.wrapper, fadeStyle]}>
      <TouchableOpacity
        testID={wrapperTestID}
        style={fadeInImageStyles.wrapper}
        onPress={onPress}
        activeOpacity={0.8}
      >
        <Image
          testID={testID}
          source={{ uri }}
          style={imageStyle}
          resizeMode="cover"
          onLoad={() => { opacity.value = withTiming(1, { duration: 300 }); }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const fadeInImageStyles = StyleSheet.create({
  wrapper: {
    borderRadius: 12,
    overflow: 'hidden',
  },
});

/**
 * Full-width image for tool-produced figures (e.g. run_python matplotlib plots).
 * Unlike a user attachment thumbnail, a plot is the result the user asked for, so
 * it spans the full content width and keeps its own aspect ratio (measured from
 * the file) instead of being cropped into a fixed square.
 */
function PlotImage({ uri, testID, wrapperTestID, onPress }: Omit<FadeInImageProps, 'imageStyle'>) {
  const opacity = useSharedValue(0);
  const fadeStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  // Fallback ratio until the real size loads; matplotlib's default figure is ~4:3.
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  useEffect(() => {
    let alive = true;
    Image.getSize(
      uri,
      (w, h) => { if (alive && w > 0 && h > 0) setAspectRatio(w / h); },
      () => { /* keep the fallback ratio */ },
    );
    return () => { alive = false; };
  }, [uri]);
  return (
    <Animated.View style={[plotImageStyles.wrapper, fadeStyle]}>
      <TouchableOpacity testID={wrapperTestID} onPress={onPress} activeOpacity={0.9}>
        <Image
          testID={testID}
          source={{ uri }}
          style={[plotImageStyles.image, { aspectRatio }]}
          resizeMode="contain"
          onLoad={() => { opacity.value = withTiming(1, { duration: 300 }); }}
        />
      </TouchableOpacity>
    </Animated.View>
  );
}

const plotImageStyles = StyleSheet.create({
  // Full-width column so plots stack edge to edge instead of shrinking to a
  // thumbnail row. alignSelf stretches past the tool bubble's centered layout.
  generatedContainer: {
    width: '100%',
    alignSelf: 'stretch',
    marginBottom: 8,
  },
  wrapper: {
    width: '100%',
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 4,
  },
  image: {
    width: '100%',
    borderRadius: 12,
  },
});

function formatFileSize(bytes: number): string {
  if (bytes < 1024) { return `${bytes}B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(0)}KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface MessageAttachmentsProps {
  attachments: MediaAttachment[];
  isUser: boolean;
  styles: any;
  colors: any;
  onImagePress?: (uri: string) => void;
}

export function MessageAttachments({
  attachments,
  isUser,
  styles,
  colors,
  onImagePress,
}: MessageAttachmentsProps) {
  return (
    <View testID="message-attachments" style={isUser ? styles.attachmentsContainer : plotImageStyles.generatedContainer}>
      {attachments.map((attachment, index) =>
        attachment.type === 'audio' ? (
          <View
            key={attachment.id}
            style={[
              styles.documentBadge,
              isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
            ]}
          >
            <Icon name="mic" size={14} color={isUser ? colors.background : colors.textSecondary} />
            <Text
              style={[styles.documentBadgeText, isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant]}
            >
              Voice message
            </Text>
          </View>
        ) : attachment.type === 'document' ? (
          <TouchableOpacity
            key={attachment.id}
            testID={`document-badge-${index}`}
            style={[
              styles.documentBadge,
              isUser ? styles.documentBadgeUser : styles.documentBadgeAssistant,
            ]}
            onPress={() => {
              if (!attachment.uri) { return; }
              const ext = (attachment.fileName || '').split('.').pop()?.toLowerCase();
              const mimeMap: Record<string, string> = {
                pdf: 'application/pdf',
                txt: 'text/plain',
                md: 'text/markdown',
                csv: 'text/csv',
                json: 'application/json',
                xml: 'application/xml',
                html: 'text/html',
                py: 'text/x-python',
                js: 'text/javascript',
                ts: 'text/typescript',
              };
              const mimeType = ext ? mimeMap[ext] || 'application/octet-stream' : undefined;
              let uri = attachment.uri;
              if (uri.startsWith('/')) {
                uri = `file://${uri}`;
              } else if (!uri.includes('://')) {
                uri = `file://${uri}`;
              }
              logger.log('[ChatMessage] Opening document:', uri);
              viewDocument({ uri, mimeType, grantPermissions: 'read' }).catch((err: any) => {
                logger.warn('[ChatMessage] Failed to open document:', err?.message || err);
              });
            }}
            activeOpacity={0.7}
          >
            <Icon name="file-text" size={14} color={isUser ? colors.background : colors.textSecondary} />
            <Text
              style={[
                styles.documentBadgeText,
                isUser ? styles.documentBadgeTextUser : styles.documentBadgeTextAssistant,
              ]}
              numberOfLines={1}
            >
              {attachment.fileName || 'Document'}
            </Text>
            {attachment.fileSize != null && (
              <Text
                style={[
                  styles.documentBadgeSize,
                  isUser ? styles.documentBadgeSizeUser : styles.documentBadgeSizeAssistant,
                ]}
              >
                {formatFileSize(attachment.fileSize)}
              </Text>
            )}
          </TouchableOpacity>
        ) : isUser ? (
          <FadeInImage
            key={attachment.id}
            uri={attachment.uri}
            imageStyle={styles.attachmentImage}
            wrapperTestID={`message-attachment-${index}`}
            testID={`message-image-${index}`}
            onPress={() => onImagePress?.(attachment.uri)}
          />
        ) : (
          <PlotImage
            key={attachment.id}
            uri={attachment.uri}
            wrapperTestID={`generated-image-${index}`}
            testID={`generated-image-content-${index}`}
            onPress={() => onImagePress?.(attachment.uri)}
          />
        )
      )}
    </View>
  );
}
