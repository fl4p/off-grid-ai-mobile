import React from 'react';
import { Image } from 'react-native';
import { render } from '@testing-library/react-native';
import { ZoomableImage } from '../../../src/components/ZoomableImage';

describe('ZoomableImage', () => {
  it('renders the image at the given uri and testID', () => {
    const { getByTestId } = render(
      <ZoomableImage uri="file:///docs/python-plots/plot-1.png" testID="zoom-img" />,
    );
    const img = getByTestId('zoom-img');
    expect(img.props.source).toEqual({ uri: 'file:///docs/python-plots/plot-1.png' });
    // Fits the figure inside the viewport rather than cropping.
    expect(img.props.resizeMode).toBe('contain');
  });

  it('fills its container so the plot uses the full viewport', () => {
    const { UNSAFE_getAllByType } = render(
      <ZoomableImage uri="file:///p.png" containerStyle={{ width: 300, height: 200 }} />,
    );
    const img = UNSAFE_getAllByType(Image)[0];
    const flat = Array.isArray(img.props.style)
      ? Object.assign({}, ...img.props.style.flat())
      : img.props.style;
    expect(flat.width).toBe('100%');
    expect(flat.height).toBe('100%');
  });
});
