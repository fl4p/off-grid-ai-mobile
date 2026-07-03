import React from 'react';
import { render } from '@testing-library/react-native';
import { RecentConversations } from '../../../src/screens/HomeScreen/components/RecentConversations';
import { useProjectStore } from '../../../src/stores/projectStore';
import { createConversation, createDownloadedModel, createMessage, createProject } from '../../utils/factories';

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

const baseProps = {
  focusTrigger: 0,
  onContinueChat: jest.fn(),
  onDeleteConversation: jest.fn(),
  onSeeAll: jest.fn(),
  discoveredModels: {},
};

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
        {...baseProps}
        conversations={[conversation]}
        downloadedModels={[model]}
      />,
    );

    expect(getByText('Gemma 3n')).toBeTruthy();
  });

  it('shows the project name alongside the model for a project-scoped conversation', () => {
    const project = createProject({ id: 'proj-1', name: 'Code Review' });
    useProjectStore.setState({ projects: [project] });
    const model = createDownloadedModel({ id: 'model-1', name: 'Gemma 3n' });
    const conversation = createConversation({
      title: 'Model chat',
      modelId: model.id,
      projectId: project.id,
    });

    const { getByText } = render(
      <RecentConversations
        {...baseProps}
        conversations={[conversation]}
        downloadedModels={[model]}
      />,
    );

    // Both the model name and the project name render in the meta row.
    expect(getByText('Gemma 3n')).toBeTruthy();
    expect(getByText('Code Review')).toBeTruthy();
  });

  it('shows no project name for a conversation without a project', () => {
    const project = createProject({ id: 'proj-1', name: 'Code Review' });
    useProjectStore.setState({ projects: [project] });
    const model = createDownloadedModel({ id: 'model-1', name: 'Gemma 3n' });
    const conversation = createConversation({
      title: 'Loose chat',
      modelId: model.id,
    });

    const { getByText, queryByText } = render(
      <RecentConversations
        {...baseProps}
        conversations={[conversation]}
        downloadedModels={[model]}
      />,
    );

    expect(getByText('Gemma 3n')).toBeTruthy();
    expect(queryByText('Code Review')).toBeNull();
  });

  it('renders the model row without crashing when projectId points at a deleted project', () => {
    useProjectStore.setState({ projects: [] });
    const model = createDownloadedModel({ id: 'model-1', name: 'Gemma 3n' });
    const conversation = createConversation({
      title: 'Orphaned chat',
      modelId: model.id,
      projectId: 'proj-gone',
    });

    const { getByText, queryByText } = render(
      <RecentConversations
        {...baseProps}
        conversations={[conversation]}
        downloadedModels={[model]}
      />,
    );

    expect(getByText('Gemma 3n')).toBeTruthy();
    expect(queryByText('proj-gone')).toBeNull();
  });
});
