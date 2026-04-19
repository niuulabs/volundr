import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ShowcasePage } from './ShowcasePage';

describe('ShowcasePage', () => {
  it('renders the page heading', () => {
    render(<ShowcasePage />);
    expect(screen.getByText('Data Surfaces · Showcase')).toBeInTheDocument();
  });

  it('renders KPI strip with metrics', () => {
    render(<ShowcasePage />);
    expect(screen.getByText('Active Sessions')).toBeInTheDocument();
    expect(screen.getByText('Error Rate')).toBeInTheDocument();
    expect(screen.getByText('P99 Latency')).toBeInTheDocument();
    expect(screen.getByText('Throughput')).toBeInTheDocument();
  });

  it('renders FilterBar with search input', () => {
    render(<ShowcasePage />);
    expect(screen.getByPlaceholderText('Search sessions…')).toBeInTheDocument();
  });

  it('renders table in loaded state by default', () => {
    render(<ShowcasePage />);
    expect(screen.getByRole('table', { name: 'Sessions table' })).toBeInTheDocument();
    expect(screen.getByText('session-alpha')).toBeInTheDocument();
  });

  it('switches to loading state', () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId('state-btn-loading'));
    expect(screen.getByText('Loading sessions…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches to empty state', () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId('state-btn-empty'));
    expect(screen.getByText('No sessions found')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches to error state', () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId('state-btn-error'));
    expect(screen.getByText('Failed to load sessions')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('switches back to loaded state', () => {
    render(<ShowcasePage />);
    fireEvent.click(screen.getByTestId('state-btn-error'));
    fireEvent.click(screen.getByTestId('state-btn-loaded'));
    expect(screen.getByRole('table', { name: 'Sessions table' })).toBeInTheDocument();
  });

  it('filters table rows via search', () => {
    render(<ShowcasePage />);
    fireEvent.change(screen.getByPlaceholderText('Search sessions…'), {
      target: { value: 'alpha' },
    });
    expect(screen.getByText('session-alpha')).toBeInTheDocument();
    expect(screen.queryByText('session-beta')).not.toBeInTheDocument();
  });
});
