import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import type { ReactNode } from 'react';
import { createMockTyrSettingsService } from '../../adapters/mock';
import { FlockConfigSection } from './FlockConfigSection';

function buildWrapper(service: Record<string, unknown>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity, gcTime: 0 } },
    });
    return (
      <QueryClientProvider client={qc}>
        <ServicesProvider services={service}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

const meta: Meta<typeof FlockConfigSection> = {
  title: 'Plugins / Tyr / Settings / FlockConfigSection',
  component: FlockConfigSection,
};
export default meta;

type Story = StoryObj<typeof FlockConfigSection>;

export const Data: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({ 'tyr.settings': createMockTyrSettingsService() });
      return (
        <Wrapper>
          <Story />
        </Wrapper>
      );
    },
  ],
};

export const Loading: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({
        'tyr.settings': {
          getFlockConfig() {
            return new Promise(() => { /* never resolves */ });
          },
        },
      });
      return (
        <Wrapper>
          <Story />
        </Wrapper>
      );
    },
  ],
};

export const Error: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({
        'tyr.settings': {
          async getFlockConfig() {
            throw new Error('Flock config service unreachable');
          },
        },
      });
      return (
        <Wrapper>
          <Story />
        </Wrapper>
      );
    },
  ],
};
