import React, { useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';
import { MarkdownText } from '../../MarkdownText';
import { createStyles } from '../styles';
import type { Message } from '../../../types';

/** Inline generation-failure message (Issues #9/#11): the failure headline with
 *  the full request details collapsed underneath, tappable to expand. */
export const ErrorMessage: React.FC<{
  message: Message; styles: ReturnType<typeof createStyles>; colors: any;
}> = ({ message, styles, colors }) => {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = !!message.errorDetails;
  return (
    <View testID="error-message" style={styles.systemInfoContainer}>
      <TouchableOpacity
        testID="error-message-toggle"
        style={styles.toolStatusRow}
        onPress={hasDetails ? () => setExpanded(!expanded) : undefined}
        activeOpacity={hasDetails ? 0.6 : 1}
        disabled={!hasDetails}
      >
        <Icon name="alert-triangle" size={13} color={colors.error} />
        <Text style={[styles.toolStatusText, { color: colors.error }]} numberOfLines={expanded ? undefined : 3}>
          {message.content}
        </Text>
        {hasDetails && (
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={12} color={colors.textMuted} />
        )}
      </TouchableOpacity>
      {expanded && hasDetails && (
        <View testID="error-details" style={styles.toolDetailContainer}>
          <MarkdownText dimmed>{message.errorDetails!}</MarkdownText>
        </View>
      )}
    </View>
  );
};
