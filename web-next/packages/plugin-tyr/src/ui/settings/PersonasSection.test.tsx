import { describe, it, expect } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { PersonasSection } from './PersonasSection';
import type { TyrPersonaSummary } from '../../ports';

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
    name: 'custom-agent',
    permissionMode: 'read_only',
    allowedTools: ['Read'],
    iterationBudget: 10,
    isBuiltin: false,
    hasOverride: true,
    producesEvent: '',
    consumesEvents: [],
  },
];

function makeMockPersonaStore(yaml = 'name: coder\n') {
  return {
    listPersonas: async (_filter?: string) => SEED_PERSONAS,
    getPersonaYaml: async (_name: string) => yaml,
  };
}

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

describe('PersonasSection', () => {
  it('shows loading state initially', () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    expect(screen.getByText(/loading personas/i)).toBeInTheDocument();
  });

  it('renders section heading', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('Personas')).toBeInTheDocument());
  });

  it('shows persona names after loading', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('coder')).toBeInTheDocument());
    expect(screen.getByText('custom-agent')).toBeInTheDocument();
  });

  it('marks builtin persona with label', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('builtin')).toBeInTheDocument());
  });

  it('marks overridden persona with label', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('overridden')).toBeInTheDocument());
  });

  it('shows persona count', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('2 personas')).toBeInTheDocument());
  });

  it('shows YAML when persona is selected', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore('name: coder\nmodel: sonnet\n') }),
    });
    await waitFor(() => expect(screen.getByText('coder')).toBeInTheDocument());
    fireEvent.click(screen.getByText('coder'));
    await waitFor(() => expect(screen.getByText(/name: coder/)).toBeInTheDocument());
  });

  it('shows error state when service throws', async () => {
    const failing = {
      listPersonas: async () => {
        throw new Error('ravn unavailable');
      },
    };
    render(<PersonasSection />, { wrapper: wrap({ 'ravn.personas': failing }) });
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText('ravn unavailable')).toBeInTheDocument();
  });

  it('renders filter tabs', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() =>
      expect(screen.getByRole('tablist', { name: /persona filter/i })).toBeInTheDocument(),
    );
    expect(screen.getByRole('tab', { name: 'All' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Builtin' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Custom' })).toBeInTheDocument();
  });

  it('clicking a filter tab resets selection', async () => {
    render(<PersonasSection />, {
      wrapper: wrap({ 'ravn.personas': makeMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByText('coder')).toBeInTheDocument());
    fireEvent.click(screen.getByText('coder'));
    fireEvent.click(screen.getByRole('tab', { name: 'Custom' }));

    // After switching tab, the YAML panel should show the "select a persona" prompt
    await waitFor(() => {
      const matches = screen.getAllByText(/select a persona/i);
      // The YAML panel shows the prompt (should be at least one)
      expect(matches.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('shows empty state when no personas match', async () => {
    const emptyStore = { listPersonas: async () => [] as TyrPersonaSummary[] };
    render(<PersonasSection />, { wrapper: wrap({ 'ravn.personas': emptyStore }) });
    await waitFor(() => expect(screen.getByText('No personas found.')).toBeInTheDocument());
  });
});
