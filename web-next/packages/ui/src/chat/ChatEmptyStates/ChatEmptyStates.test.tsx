import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionEmptyChat } from './ChatEmptyStates';

vi.mock('./ChatEmptyStates.module.css', () => ({ default: {} }));
vi.mock('lucide-react', () => ({
  Hammer: () => null,
}));

describe('SessionEmptyChat', () => {
  it('renders the session name', () => {
    render(<SessionEmptyChat sessionName="My Session" onSuggestionClick={vi.fn()} />);
    expect(screen.getByText('My Session')).toBeInTheDocument();
  });

  it('renders suggestion buttons', () => {
    render(<SessionEmptyChat sessionName="Test" onSuggestionClick={vi.fn()} />);
    expect(screen.getByText('Review the code and suggest improvements')).toBeInTheDocument();
    expect(screen.getByText('Run the test suite and fix failures')).toBeInTheDocument();
    expect(screen.getByText('Explain the architecture of this module')).toBeInTheDocument();
  });

  it('calls onSuggestionClick with the suggestion text when clicked', () => {
    const onSuggestionClick = vi.fn();
    render(<SessionEmptyChat sessionName="Test" onSuggestionClick={onSuggestionClick} />);
    const btn = screen.getByText('Review the code and suggest improvements');
    fireEvent.click(btn);
    expect(onSuggestionClick).toHaveBeenCalledWith('Review the code and suggest improvements');
  });

  it('calls onSuggestionClick with second suggestion text', () => {
    const onSuggestionClick = vi.fn();
    render(<SessionEmptyChat sessionName="Test" onSuggestionClick={onSuggestionClick} />);
    const btn = screen.getByText('Run the test suite and fix failures');
    fireEvent.click(btn);
    expect(onSuggestionClick).toHaveBeenCalledWith('Run the test suite and fix failures');
  });

  it('renders the subtitle text', () => {
    render(<SessionEmptyChat sessionName="Test" onSuggestionClick={vi.fn()} />);
    expect(
      screen.getByText('Start working — ask a question or give an instruction.')
    ).toBeInTheDocument();
  });
});
