import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('@/pages/Volundr', () => ({
  VolundrPage: () => <div data-testid="volundr-page">Volundr Page</div>,
}));

vi.mock('@/pages/Volundr/VolundrPopout', () => ({
  VolundrPopout: () => <div data-testid="volundr-popout">Volundr Popout</div>,
}));

import { VolundrPage } from '@/pages/Volundr';
import { VolundrPopout } from '@/pages/Volundr/VolundrPopout';

function TestApp({ initialRoute = '/' }: { initialRoute?: string }) {
  return (
    <MemoryRouter initialEntries={[initialRoute]}>
      <Routes>
        <Route path="/volundr/popout" element={<VolundrPopout />} />
        <Route path="/popout" element={<VolundrPopout />} />
        <Route path="/volundr" element={<VolundrPage />} />
        <Route path="/" element={<VolundrPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe('App', () => {
  it('renders Volundr page at /', () => {
    render(<TestApp />);
    expect(screen.getByTestId('volundr-page')).toBeInTheDocument();
  });

  it('renders Volundr page at /volundr', () => {
    render(<TestApp initialRoute="/volundr" />);
    expect(screen.getByTestId('volundr-page')).toBeInTheDocument();
  });

  it('renders popout at /volundr/popout', () => {
    render(<TestApp initialRoute="/volundr/popout" />);
    expect(screen.getByTestId('volundr-popout')).toBeInTheDocument();
  });

  it('renders popout at /popout', () => {
    render(<TestApp initialRoute="/popout" />);
    expect(screen.getByTestId('volundr-popout')).toBeInTheDocument();
  });
});
