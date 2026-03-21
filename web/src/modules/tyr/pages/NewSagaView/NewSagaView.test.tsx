import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { NewSagaView } from './NewSagaView';

vi.mock('../../adapters', () => ({
  tyrService: {
    decompose: vi.fn(() => Promise.resolve([])),
    createSaga: vi.fn(() => Promise.resolve({ id: 'new-saga-id', name: 'Test', slug: 'test' })),
  },
}));

function renderView() {
  return render(
    <MemoryRouter>
      <NewSagaView />
    </MemoryRouter>
  );
}

describe('NewSagaView', () => {
  it('renders the heading', () => {
    renderView();
    expect(screen.getByText('Create New Saga')).toBeInTheDocument();
  });

  it('renders specification textarea', () => {
    renderView();
    expect(screen.getByLabelText('Specification')).toBeInTheDocument();
  });

  it('renders repository input', () => {
    renderView();
    expect(screen.getByLabelText('Repository')).toBeInTheDocument();
  });

  it('renders decompose button', () => {
    renderView();
    expect(screen.getByText('Decompose')).toBeInTheDocument();
  });

  it('decompose button is disabled when fields are empty', () => {
    renderView();
    const button = screen.getByText('Decompose');
    expect(button).toBeDisabled();
  });

  it('decompose button is disabled when only spec is filled', async () => {
    renderView();
    const textarea = screen.getByLabelText('Specification');
    await userEvent.type(textarea, 'Some spec');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('decompose button is disabled when only repo is filled', async () => {
    renderView();
    const input = screen.getByLabelText('Repository');
    await userEvent.type(input, 'org/repo');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('decompose button is enabled when both fields are filled', async () => {
    renderView();
    await userEvent.type(screen.getByLabelText('Specification'), 'Some spec');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');
    expect(screen.getByText('Decompose')).toBeEnabled();
  });

  it('decompose button is disabled when fields are whitespace only', async () => {
    renderView();
    await userEvent.type(screen.getByLabelText('Specification'), '   ');
    await userEvent.type(screen.getByLabelText('Repository'), '   ');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('clicking decompose shows preview section', async () => {
    renderView();
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');

    await userEvent.click(screen.getByText('Decompose'));

    await waitFor(() => {
      expect(screen.getByText('Phase Preview')).toBeInTheDocument();
    });
    expect(
      screen.getByText('No phases generated. Try refining the specification.')
    ).toBeInTheDocument();
  });

  it('does not show preview section initially', () => {
    renderView();
    expect(screen.queryByText('Phase Preview')).not.toBeInTheDocument();
  });

  it('does not show commit button when preview has zero phases', async () => {
    renderView();
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');
    await userEvent.click(screen.getByText('Decompose'));

    await waitFor(() => {
      expect(screen.getByText('Phase Preview')).toBeInTheDocument();
    });
    expect(screen.queryByText('Commit')).not.toBeInTheDocument();
  });

  it('shows decomposing text while decompose is in progress', async () => {
    renderView();
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');

    fireEvent.click(screen.getByText('Decompose'));

    await waitFor(() => {
      expect(screen.getByText('Decompose')).toBeInTheDocument();
    });
  });

  it('updates spec textarea value on change', async () => {
    renderView();
    const textarea = screen.getByLabelText('Specification') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'New feature');
    expect(textarea.value).toBe('New feature');
  });

  it('updates repo input value on change', async () => {
    renderView();
    const input = screen.getByLabelText('Repository') as HTMLInputElement;
    await userEvent.type(input, 'niuulabs/app');
    expect(input.value).toBe('niuulabs/app');
  });
});
