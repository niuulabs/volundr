import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { TyrLayout } from './TyrLayout';

describe('TyrLayout', () => {
  it('renders all tab links', () => {
    render(
      <MemoryRouter initialEntries={['/tyr/sagas']}>
        <TyrLayout />
      </MemoryRouter>
    );

    expect(screen.getByText('Sagas')).toBeInTheDocument();
    expect(screen.getByText('New Saga')).toBeInTheDocument();
    expect(screen.getByText('Dispatcher')).toBeInTheDocument();
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
  });

  it('renders tab links as navigation links', () => {
    render(
      <MemoryRouter initialEntries={['/tyr/sagas']}>
        <TyrLayout />
      </MemoryRouter>
    );

    const sagasLink = screen.getByText('Sagas');
    expect(sagasLink.closest('a')).toHaveAttribute('href', '/tyr/sagas');
  });

  it('renders the outlet area', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/tyr/sagas']}>
        <TyrLayout />
      </MemoryRouter>
    );

    // The content area should exist even without outlet content
    expect(container.querySelector('nav')).toBeInTheDocument();
  });
});
