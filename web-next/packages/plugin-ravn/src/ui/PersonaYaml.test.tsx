import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { PersonaYaml } from './PersonaYaml';
import { createMockPersonaStore } from '../adapters/mock';

function wrap(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

describe('PersonaYaml', () => {
  it('shows loading state while fetching', () => {
    const slowService = {
      getPersonaYaml: () => new Promise(() => {}),
      listPersonas: () => new Promise(() => {}),
    };
    render(<PersonaYaml name="reviewer" />, {
      wrapper: wrap({ 'ravn.personas': slowService }),
    });
    expect(screen.getByTestId('persona-yaml-loading')).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failing = {
      getPersonaYaml: async () => {
        throw new Error('yaml fetch failed');
      },
      listPersonas: async () => [],
    };
    render(<PersonaYaml name="reviewer" />, {
      wrapper: wrap({ 'ravn.personas': failing }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-yaml-error')).toBeInTheDocument());
    expect(screen.getByText('yaml fetch failed')).toBeInTheDocument();
  });

  it('renders YAML content', async () => {
    render(<PersonaYaml name="reviewer" />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-yaml')).toBeInTheDocument());

    expect(screen.getByTestId('persona-yaml').textContent).toContain('reviewer');
  });

  it('renders YAML in a pre element', async () => {
    render(<PersonaYaml name="reviewer" />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-yaml')).toBeInTheDocument());
    const container = screen.getByTestId('persona-yaml');
    expect(container.querySelector('pre')).toBeInTheDocument();
  });
});
