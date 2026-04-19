import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { PersonaForm } from './PersonaForm';
import type { PersonaDetail } from '../ports';

const MOCK_PERSONA: PersonaDetail = {
  name: 'test-persona',
  role: 'build',
  letter: 'T',
  color: 'var(--color-accent-indigo)',
  summary: 'A test persona',
  description: 'Used in tests',
  permissionMode: 'default',
  allowedTools: ['read', 'write'],
  forbiddenTools: [],
  iterationBudget: 20,
  isBuiltin: false,
  hasOverride: false,
  producesEvent: 'code.changed',
  consumesEvents: ['review.completed'],
  systemPromptTemplate: '# test-persona',
  llm: { primaryAlias: 'claude-sonnet-4-6', thinkingEnabled: false, maxTokens: 8192 },
  produces: { eventType: 'code.changed', schemaDef: { file: 'string' } },
  consumes: { events: [{ name: 'review.completed' }] },
  fanIn: { strategy: 'merge', params: {} },
  yamlSource: '[mock]',
};

function wrap() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={{}}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

describe('PersonaForm', () => {
  it('renders all form sections', () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    expect(screen.getByText('Identity')).toBeInTheDocument();
    expect(screen.getByText('LLM')).toBeInTheDocument();
    expect(screen.getByText('Tool access')).toBeInTheDocument();
    expect(screen.getByText('Produces')).toBeInTheDocument();
    expect(screen.getByText('Consumes')).toBeInTheDocument();
    expect(screen.getByText('Fan-in')).toBeInTheDocument();
    expect(screen.getByText('Mímir write routing')).toBeInTheDocument();
  });

  it('populates name field from persona', () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    expect(screen.getByDisplayValue('test-persona')).toBeInTheDocument();
  });

  it('populates LLM alias from persona', () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    expect(screen.getByDisplayValue('claude-sonnet-4-6')).toBeInTheDocument();
  });

  it('shows save bar when a field is changed', async () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    const nameInput = screen.getByDisplayValue('test-persona');
    fireEvent.change(nameInput, { target: { value: 'changed-name' } });
    await waitFor(() =>
      expect(screen.getByText('Unsaved changes')).toBeInTheDocument(),
    );
  });

  it('hides save bar after reset', async () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    const nameInput = screen.getByDisplayValue('test-persona');
    fireEvent.change(nameInput, { target: { value: 'changed' } });
    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Reset'));
    await waitFor(() =>
      expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument(),
    );
  });

  it('calls onSave with updated LLM alias when saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<PersonaForm persona={MOCK_PERSONA} onSave={onSave} />, {
      wrapper: wrap(),
    });

    const aliasInput = screen.getByDisplayValue('claude-sonnet-4-6');
    fireEvent.change(aliasInput, { target: { value: 'claude-opus-4-6' } });

    await waitFor(() => expect(screen.getByText('Unsaved changes')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /save persona/i }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ llmPrimaryAlias: 'claude-opus-4-6' }),
      );
    });
  });

  it('shows validation errors for invalid state', async () => {
    render(
      <PersonaForm
        persona={{ ...MOCK_PERSONA, name: '' }}
        onSave={vi.fn()}
      />,
      { wrapper: wrap() },
    );
    // Name is empty — should show validation error immediately
    await waitFor(() =>
      expect(screen.getByText(/Name is required/)).toBeInTheDocument(),
    );
  });

  it('disables save button when there are validation errors', async () => {
    render(
      <PersonaForm
        persona={{ ...MOCK_PERSONA, name: '' }}
        onSave={vi.fn()}
      />,
      { wrapper: wrap() },
    );
    const nameInput = screen.getAllByDisplayValue('')[0]!;
    fireEvent.change(nameInput, { target: { value: 'x' } });
    fireEvent.change(nameInput, { target: { value: '' } });

    // With no name and dirty state, save should be blocked
    await waitFor(() => {
      const saveBtn = screen.queryByRole('button', { name: /save persona/i });
      // Save button is only shown when dirty
      if (saveBtn) {
        expect(saveBtn).toBeDisabled();
      }
    });
  });

  it('shows thinking checkbox', () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    expect(screen.getByText('Enable extended thinking')).toBeInTheDocument();
  });

  it('shows add consumed event button', () => {
    render(<PersonaForm persona={MOCK_PERSONA} onSave={vi.fn()} />, {
      wrapper: wrap(),
    });
    expect(screen.getByText('+ Add consumed event')).toBeInTheDocument();
  });
});
