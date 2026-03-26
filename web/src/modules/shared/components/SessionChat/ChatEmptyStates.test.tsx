import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SessionEmptyChat } from './ChatEmptyStates';

describe('SessionEmptyChat', () => {
  const defaultProps = {
    sessionName: 'Test Session',
    onSuggestionClick: vi.fn(),
  };

  it('renders session name as title', () => {
    render(<SessionEmptyChat {...defaultProps} />);

    expect(screen.getByText('Test Session')).toBeInTheDocument();
  });

  it('renders subtitle text', () => {
    render(<SessionEmptyChat {...defaultProps} />);

    expect(
      screen.getByText('Start working — ask a question or give an instruction.')
    ).toBeInTheDocument();
  });

  it('renders all 3 suggestion buttons', () => {
    render(<SessionEmptyChat {...defaultProps} />);

    expect(screen.getByText('Review the code and suggest improvements')).toBeInTheDocument();
    expect(screen.getByText('Run the test suite and fix failures')).toBeInTheDocument();
    expect(screen.getByText('Explain the architecture of this module')).toBeInTheDocument();
  });

  it('calls onSuggestionClick with suggestion text when first suggestion is clicked', () => {
    const onSuggestionClick = vi.fn();
    render(<SessionEmptyChat sessionName="Session" onSuggestionClick={onSuggestionClick} />);

    fireEvent.click(screen.getByText('Review the code and suggest improvements'));

    expect(onSuggestionClick).toHaveBeenCalledWith('Review the code and suggest improvements');
  });

  it('calls onSuggestionClick with suggestion text when second suggestion is clicked', () => {
    const onSuggestionClick = vi.fn();
    render(<SessionEmptyChat sessionName="Session" onSuggestionClick={onSuggestionClick} />);

    fireEvent.click(screen.getByText('Run the test suite and fix failures'));

    expect(onSuggestionClick).toHaveBeenCalledWith('Run the test suite and fix failures');
  });

  it('calls onSuggestionClick with suggestion text when third suggestion is clicked', () => {
    const onSuggestionClick = vi.fn();
    render(<SessionEmptyChat sessionName="Session" onSuggestionClick={onSuggestionClick} />);

    fireEvent.click(screen.getByText('Explain the architecture of this module'));

    expect(onSuggestionClick).toHaveBeenCalledWith('Explain the architecture of this module');
  });

  it('renders hammer icon', () => {
    const { container } = render(<SessionEmptyChat {...defaultProps} />);

    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });
});
