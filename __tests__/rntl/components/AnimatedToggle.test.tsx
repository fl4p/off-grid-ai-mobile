import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { AnimatedToggle } from '../../../src/components/AnimatedToggle';

describe('AnimatedToggle', () => {
  it('calls onValueChange with the negated value when pressed', () => {
    const onValueChange = jest.fn();
    const { getByTestId } = render(
      <AnimatedToggle value={false} onValueChange={onValueChange} testID="t" />,
    );
    fireEvent.press(getByTestId('t'));
    expect(onValueChange).toHaveBeenCalledWith(true);
  });

  it('negates from on to off', () => {
    const onValueChange = jest.fn();
    const { getByTestId } = render(
      <AnimatedToggle value onValueChange={onValueChange} testID="t" />,
    );
    fireEvent.press(getByTestId('t'));
    expect(onValueChange).toHaveBeenCalledWith(false);
  });

  it('does not fire when disabled', () => {
    const onValueChange = jest.fn();
    const { getByTestId } = render(
      <AnimatedToggle value={false} onValueChange={onValueChange} disabled testID="t" />,
    );
    fireEvent.press(getByTestId('t'));
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('exposes switch accessibility state', () => {
    const { getByTestId } = render(
      <AnimatedToggle value onValueChange={() => {}} testID="t" />,
    );
    expect(getByTestId('t').props.accessibilityState).toMatchObject({ checked: true });
  });
});
