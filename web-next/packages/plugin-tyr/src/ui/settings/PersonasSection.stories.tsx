import type { Meta, StoryObj } from '@storybook/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import type { ReactNode } from 'react';
import type { TyrPersonaSummary } from '../../ports';
import { PersonasSection } from './PersonasSection';

const SEED_PERSONAS: TyrPersonaSummary[] = [
  {
    name: 'coder',
    permissionMode: 'workspace_write',
    allowedTools: ['Bash', 'Read', 'Write', 'Edit'],
    iterationBudget: 40,
    isBuiltin: true,
    hasOverride: false,
    producesEvent: 'code.changed',
    consumesEvents: [],
  },
  {
    name: 'reviewer',
    permissionMode: 'read_only',
    allowedTools: ['Read', 'Grep', 'Glob'],
    iterationBudget: 20,
    isBuiltin: true,
    hasOverride: true,
    producesEvent: 'review.complete',
    consumesEvents: ['code.changed'],
  },
  {
    name: 'custom-agent',
    permissionMode: 'read_only',
    allowedTools: ['Read'],
    iterationBudget: 10,
    isBuiltin: false,
    hasOverride: false,
    producesEvent: '',
    consumesEvents: [],
  },
];

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

const meta: Meta<typeof PersonasSection> = {
  title: 'Plugins / Tyr / Settings / PersonasSection',
  component: PersonasSection,
};
export default meta;

type Story = StoryObj<typeof PersonasSection>;

export const Data: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({
        'ravn.personas': {
          async listPersonas() { return SEED_PERSONAS; },
          async getPersonaYaml(name: string) {
            return `name: ${name}\nmodel: claude-sonnet-4-6\niterationBudget: 40\n`;
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

export const Loading: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({
        'ravn.personas': {
          listPersonas() {
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
        'ravn.personas': {
          async listPersonas() {
            throw new Error('Ravn persona service unreachable');
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

export const Empty: Story = {
  decorators: [
    (Story) => {
      const Wrapper = buildWrapper({
        'ravn.personas': {
          async listPersonas() { return []; },
          async getPersonaYaml() { return ''; },
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
