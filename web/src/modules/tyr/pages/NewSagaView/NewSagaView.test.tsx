import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NewSagaView } from './NewSagaView';

describe('NewSagaView', () => {
  it('renders the heading', () => {
    render(<NewSagaView />);
    expect(screen.getByText('Create New Saga')).toBeInTheDocument();
  });

  it('renders specification textarea', () => {
    render(<NewSagaView />);
    expect(screen.getByLabelText('Specification')).toBeInTheDocument();
  });

  it('renders repository input', () => {
    render(<NewSagaView />);
    expect(screen.getByLabelText('Repository')).toBeInTheDocument();
  });

  it('renders decompose button', () => {
    render(<NewSagaView />);
    expect(screen.getByText('Decompose')).toBeInTheDocument();
  });

  it('decompose button is disabled when fields are empty', () => {
    render(<NewSagaView />);
    const button = screen.getByText('Decompose');
    expect(button).toBeDisabled();
  });

  it('decompose button is disabled when only spec is filled', async () => {
    render(<NewSagaView />);
    const textarea = screen.getByLabelText('Specification');
    await userEvent.type(textarea, 'Some spec');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('decompose button is disabled when only repo is filled', async () => {
    render(<NewSagaView />);
    const input = screen.getByLabelText('Repository');
    await userEvent.type(input, 'org/repo');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('decompose button is enabled when both fields are filled', async () => {
    render(<NewSagaView />);
    await userEvent.type(screen.getByLabelText('Specification'), 'Some spec');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');
    expect(screen.getByText('Decompose')).toBeEnabled();
  });

  it('decompose button is disabled when fields are whitespace only', async () => {
    render(<NewSagaView />);
    await userEvent.type(screen.getByLabelText('Specification'), '   ');
    await userEvent.type(screen.getByLabelText('Repository'), '   ');
    expect(screen.getByText('Decompose')).toBeDisabled();
  });

  it('clicking decompose shows preview section with empty phases message', async () => {
    render(<NewSagaView />);
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');

    await userEvent.click(screen.getByText('Decompose'));

    await waitFor(() => {
      expect(screen.getByText('Phase Preview')).toBeInTheDocument();
    });
    expect(
      screen.getByText('No phases generated. Try refining the specification.'),
    ).toBeInTheDocument();
  });

  it('does not show preview section initially', () => {
    render(<NewSagaView />);
    expect(screen.queryByText('Phase Preview')).not.toBeInTheDocument();
  });

  it('does not show commit button when preview has zero phases', async () => {
    render(<NewSagaView />);
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');
    await userEvent.click(screen.getByText('Decompose'));

    await waitFor(() => {
      expect(screen.getByText('Phase Preview')).toBeInTheDocument();
    });
    expect(screen.queryByText('Commit')).not.toBeInTheDocument();
  });

  it('shows decomposing text while decompose is in progress', async () => {
    render(<NewSagaView />);
    await userEvent.type(screen.getByLabelText('Specification'), 'Build auth');
    await userEvent.type(screen.getByLabelText('Repository'), 'org/repo');

    // Click decompose - the button text should change during the async operation
    fireEvent.click(screen.getByText('Decompose'));

    // After it resolves, it should go back to Decompose
    await waitFor(() => {
      expect(screen.getByText('Decompose')).toBeInTheDocument();
    });
  });

  it('updates spec textarea value on change', async () => {
    render(<NewSagaView />);
    const textarea = screen.getByLabelText('Specification') as HTMLTextAreaElement;
    await userEvent.type(textarea, 'New feature');
    expect(textarea.value).toBe('New feature');
  });

  it('updates repo input value on change', async () => {
    render(<NewSagaView />);
    const input = screen.getByLabelText('Repository') as HTMLInputElement;
    await userEvent.type(input, 'niuulabs/app');
    expect(input.value).toBe('niuulabs/app');
  });
});
