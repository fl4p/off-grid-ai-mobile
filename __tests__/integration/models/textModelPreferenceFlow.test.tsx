import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { ModelSelectorModal } from '../../../src/components/ModelSelectorModal';
import { useAppStore } from '../../../src/stores/appStore';
import { resetStores } from '../../utils/testHelpers';
import { createDownloadedModel } from '../../utils/factories';

jest.mock('../../../src/components/AppSheet', () => ({
  AppSheet: ({ visible, children, title }: any) => {
    if (!visible) return null;
    const { Text, View } = require('react-native');
    return (
      <View testID="app-sheet">
        <Text>{title}</Text>
        {children}
      </View>
    );
  },
}));

jest.mock('../../../src/services', () => ({
  activeModelService: {
    loadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadImageModel: jest.fn().mockResolvedValue(undefined),
    unloadTextModel: jest.fn().mockResolvedValue(undefined),
  },
  llmService: {
    isModelLoaded: jest.fn(() => false),
  },
  hardwareService: {
    formatModelSize: jest.fn(() => '4.0 GB'),
  },
  remoteServerManager: {
    clearActiveRemoteModel: jest.fn(),
    setActiveRemoteTextModel: jest.fn().mockResolvedValue(undefined),
    setActiveRemoteImageModel: jest.fn().mockResolvedValue(undefined),
  },
}));

describe('text model preference flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetStores();
  });

  it('does not record a local model as recent before parent selection succeeds', () => {
    useAppStore.getState().setDownloadedModels([
      createDownloadedModel({
        id: 'local-model',
        name: 'Local Alpha',
        filePath: '/models/local-alpha.gguf',
      }),
    ]);

    const onSelectModel = jest.fn();
    const { getByLabelText, getAllByLabelText } = render(
      <ModelSelectorModal
        visible
        onClose={jest.fn()}
        onSelectModel={onSelectModel}
        onUnloadModel={jest.fn()}
        isLoading={false}
        currentModelPath={null}
      />,
    );

    fireEvent.press(getByLabelText('Select Local Alpha'));
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: 'local-model' }));
    expect(useAppStore.getState().recentTextModelKeys).toEqual([]);

    fireEvent.press(getAllByLabelText('Add favorite Local Alpha')[0]);
    expect(useAppStore.getState().favoriteTextModelKeys).toEqual(['local:local-model']);
  });

});
