import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentsView } from './AgentsView';

describe('AgentsView', () => {
  it('renders the heading', () => {
    render(<AgentsView />);
    expect(screen.getByText(/agent configuration/i)).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<AgentsView />);
    expect(screen.getByText(/configure ravn agent settings/i)).toBeInTheDocument();
  });

  it('renders the platform tools section heading', () => {
    render(<AgentsView />);
    expect(screen.getByText(/platform tools/i)).toBeInTheDocument();
  });

  it('renders all four platform tools', () => {
    render(<AgentsView />);
    expect(screen.getByText('volundr_session')).toBeInTheDocument();
    expect(screen.getByText('volundr_git')).toBeInTheDocument();
    expect(screen.getByText('tyr_saga')).toBeInTheDocument();
    expect(screen.getByText('tracker_issue')).toBeInTheDocument();
  });

  it('renders volundr_session description', () => {
    render(<AgentsView />);
    expect(screen.getByText(/create, start, stop/i)).toBeInTheDocument();
  });

  it('renders volundr_git description', () => {
    render(<AgentsView />);
    expect(screen.getByText(/git operations/i)).toBeInTheDocument();
  });

  it('renders tyr_saga description', () => {
    render(<AgentsView />);
    expect(screen.getByText(/decompose specs/i)).toBeInTheDocument();
  });

  it('renders tracker_issue description', () => {
    render(<AgentsView />);
    expect(screen.getByText(/linear \/ jira/i)).toBeInTheDocument();
  });
});
