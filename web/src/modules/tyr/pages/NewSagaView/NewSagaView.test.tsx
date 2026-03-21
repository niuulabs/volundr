import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
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
});
