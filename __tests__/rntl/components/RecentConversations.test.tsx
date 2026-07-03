import React from 'react';
import { render } from '@testing-library/react-native';
import { RecentConversations } from '../../../src/screens/HomeScreen/components/RecentConversations';
import { createConversation, createDownloadedModel, createMessage } from '../../utils/factories';

jest.mock('react-native-gesture-handler/Swipeable', () => {
  return ({ children }: any) => {
    const { View } = require('react-native');
    return <View>{children}</View>;
  };
});

jest.mock('../../../src/components/AnimatedListItem', () => ({
  AnimatedListItem: ({ children, testID }: any) => {
    const { View } = require('react-native');
    return <View testID={testID}>{children}</View>;
  },
}));

describe('RecentConversations', () => {
  it('shows the model used by each recent conversation', () => {
    const model = createDownloadedModel({ id: 'model-1', name: 'Gemma 3n' });
    const conversation = createConversation({
      title: 'Model chat',
      modelId: model.id,
      messages: [createMessage({ role: 'user', content: 'Hello' })],
    });

    const { getByText } = render(
      <RecentConversations
        conversations={[conversation]}
        focusTrigger={0}
        onContinueChat={jest.fn()}
        onDeleteConversation={jest.fn()}
        onSeeAll={jest.fn()}
        downloadedModels={[model]}
        discoveredModels={{}}
      />,
    );

    expect(getByText('Gemma 3n')).toBeTruthy();
  });
});
