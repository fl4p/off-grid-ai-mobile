import React, { useState } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle, TextStyle } from 'react-native';
import Icon from 'react-native-vector-icons/Feather';

interface ApiKeyInputProps {
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  placeholderTextColor?: string;
  /** Colour for the show/hide eye icon. */
  iconColor?: string;
  /** Icon size, defaults to 18. */
  iconSize?: number;
  containerStyle?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  toggleStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * Masked API-key field with a show/hide eye toggle. Shared by the remote-server
 * modal and the web-search settings screen so both key inputs behave identically
 * (single source of truth for the reveal behaviour). Styling is passed in so
 * each call site keeps its own look.
 */
export const ApiKeyInput: React.FC<ApiKeyInputProps> = ({
  value,
  onChangeText,
  placeholder,
  placeholderTextColor,
  iconColor,
  iconSize = 18,
  containerStyle,
  inputStyle,
  toggleStyle,
  testID,
}) => {
  const [show, setShow] = useState(false);

  return (
    <View style={containerStyle}>
      <TextInput
        testID={testID}
        style={inputStyle}
        placeholder={placeholder}
        placeholderTextColor={placeholderTextColor}
        value={value}
        onChangeText={onChangeText}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={!show}
      />
      <TouchableOpacity style={toggleStyle} onPress={() => setShow(v => !v)}>
        <Icon name={show ? 'eye-off' : 'eye'} size={iconSize} color={iconColor} />
      </TouchableOpacity>
    </View>
  );
};
