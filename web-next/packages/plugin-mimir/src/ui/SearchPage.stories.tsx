import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SearchPage } from './SearchPage';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

function makeClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function withMimir(service?: IMimirService) {
  const svc = service ?? createMimirMockAdapter();
  return (Story: React.ComponentType) => (
    <QueryClientProvider client={makeClient()}>
      <ServicesProvider services={{ mimir: svc }}>
        <Story />
      </ServicesProvider>
    </QueryClientProvider>
  );
}

const meta: Meta<typeof SearchPage> = {
  title: 'Mímir/SearchPage',
  component: SearchPage,
  decorators: [withMimir()],
  parameters: { layout: 'fullscreen' },
};
export default meta;

type Story = StoryObj<typeof SearchPage>;

export const Default: Story = {};

export const WithError: Story = {
  decorators: [
    withMimir({
      ...createMimirMockAdapter(),
      pages: {
        ...createMimirMockAdapter().pages,
        search: async () => {
          throw new Error('Search service unavailable');
        },
      },
    }),
  ],
};
