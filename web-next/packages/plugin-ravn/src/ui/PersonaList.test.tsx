import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { PersonaList } from './PersonaList';
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

describe('PersonaList', () => {
  it('shows loading state while fetching', () => {
    const slowService = {
      listPersonas: () => new Promise(() => {}),
    };
    render(<PersonaList selectedName={null} onSelect={() => {}} />, {
      wrapper: wrap({ 'ravn.personas': slowService }),
    });
    expect(screen.getByTestId('persona-list-loading')).toBeInTheDocument();
  });

  it('shows error state when service throws', async () => {
    const failing = {
      listPersonas: async () => {
        throw new Error('service unavailable');
      },
    };
    render(<PersonaList selectedName={null} onSelect={() => {}} />, {
      wrapper: wrap({ 'ravn.personas': failing }),
    });
    await waitFor(() =>
      expect(screen.getByTestId('persona-list-error')).toBeInTheDocument(),
    );
    expect(screen.getByText('service unavailable')).toBeInTheDocument();
  });

  it('renders a list of personas grouped by role', async () => {
    render(<PersonaList selectedName={null} onSelect={() => {}} />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());

    // Should show role labels
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('Review')).toBeInTheDocument();

    // Should show persona names
    expect(screen.getByText('reviewer')).toBeInTheDocument();
    expect(screen.getByText('coding-agent')).toBeInTheDocument();
  });

  it('marks the selected persona with aria-current="page"', async () => {
    render(<PersonaList selectedName="reviewer" onSelect={() => {}} />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());

    const selected = screen.getByRole('button', { name: /reviewer/ });
    expect(selected).toHaveAttribute('aria-current', 'page');
  });

  it('calls onSelect when a persona is clicked', async () => {
    const onSelect = vi.fn();
    render(<PersonaList selectedName={null} onSelect={onSelect} />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /coder/ }));
    expect(onSelect).toHaveBeenCalledWith('coder');
  });

  it('shows "builtin" badge for builtin personas', async () => {
    render(<PersonaList selectedName={null} onSelect={() => {}} />, {
      wrapper: wrap({ 'ravn.personas': createMockPersonaStore() }),
    });
    await waitFor(() => expect(screen.getByTestId('persona-list')).toBeInTheDocument());

    const builtinBadges = screen.getAllByText('builtin');
    expect(builtinBadges.length).toBeGreaterThan(0);
  });
});
