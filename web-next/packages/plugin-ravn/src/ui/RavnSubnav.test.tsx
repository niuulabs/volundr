import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RavnSubnav } from './RavnSubnav';
import {
  createMockRavenStream,
  createMockSessionStream,
  createMockPersonaStore,
  createMockTriggerStore,
  createMockBudgetStream,
} from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

// Mock TanStack Router so we can control the pathname
const mockPathname = vi.fn(() => '/ravn');

vi.mock('@tanstack/react-router', () => ({
  useRouterState: ({ select }: { select: (s: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: mockPathname() } }),
  useRouter: () => ({ navigate: vi.fn() }),
}));

function services() {
  return {
    'ravn.personas': createMockPersonaStore(),
    'ravn.ravens': createMockRavenStream(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.budget': createMockBudgetStream(),
  };
}

beforeEach(() => {
  localStorage.clear();
  mockPathname.mockReturnValue('/ravn');
});

describe('RavnSubnav — overview route', () => {
  it('renders null for /ravn (overview)', () => {
    mockPathname.mockReturnValue('/ravn');
    const { container } = render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    expect(container.firstChild).toBeNull();
  });

  it('renders null for /ravn/ravens', () => {
    mockPathname.mockReturnValue('/ravn/ravens');
    const { container } = render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    expect(container.firstChild).toBeNull();
  });

  it('renders null for /ravn/budget', () => {
    mockPathname.mockReturnValue('/ravn/budget');
    const { container } = render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    expect(container.firstChild).toBeNull();
  });
});

describe('RavnSubnav — personas route', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/ravn/personas');
  });

  it('renders personas subnav on /ravn/personas', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() => expect(screen.getByTestId('personas-subnav')).toBeInTheDocument());
  });

  it('shows the Personas section header', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() => expect(screen.getByText('Personas')).toBeInTheDocument());
  });

  it('shows "cognitive templates" subtitle', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() => expect(screen.getByText('cognitive templates')).toBeInTheDocument());
  });

  it('shows persona count', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    // Mock has 21 personas
    await waitFor(() => expect(screen.getByText('21')).toBeInTheDocument());
  });

  it('shows persona items grouped by role', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() =>
      expect(screen.getByTestId('persona-subnav-item-architect')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('persona-subnav-item-reviewer')).toBeInTheDocument();
  });

  it('dispatches ravn:persona-selected event on click', async () => {
    const handler = vi.fn();
    window.addEventListener('ravn:persona-selected', handler);

    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() =>
      expect(screen.getByTestId('persona-subnav-item-architect')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('persona-subnav-item-architect'));
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0][0] as CustomEvent).detail).toBe('architect');

    window.removeEventListener('ravn:persona-selected', handler);
  });

  it('saves selected persona to localStorage', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() =>
      expect(screen.getByTestId('persona-subnav-item-architect')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('persona-subnav-item-architect'));
    expect(localStorage.getItem('ravn.persona')).toBe('"architect"');
  });
});

describe('RavnSubnav — sessions route', () => {
  beforeEach(() => {
    mockPathname.mockReturnValue('/ravn/sessions');
  });

  it('renders sessions subnav on /ravn/sessions', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() => expect(screen.getByTestId('sessions-subnav')).toBeInTheDocument());
  });

  it('shows Sessions header', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() => expect(screen.getByText('Sessions')).toBeInTheDocument());
  });

  it('shows active/closed counts in subtitle', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    // Mock has 3 running (active) + 3 non-running (closed) sessions
    await waitFor(() => {
      expect(screen.getByText(/3 active/)).toBeInTheDocument();
      expect(screen.getByText(/3 closed/)).toBeInTheDocument();
    });
  });

  it('shows running sessions with title', async () => {
    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() =>
      expect(screen.getByText('Implement login form')).toBeInTheDocument(),
    );
  });

  it('dispatches ravn:session-selected event on click', async () => {
    const handler = vi.fn();
    window.addEventListener('ravn:session-selected', handler);

    render(<RavnSubnav />, { wrapper: wrapWithServices(services()) });
    await waitFor(() =>
      expect(
        screen.getByTestId('session-subnav-item-10000001-0000-4000-8000-000000000001'),
      ).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByTestId('session-subnav-item-10000001-0000-4000-8000-000000000001'),
    );
    expect(handler).toHaveBeenCalledOnce();

    window.removeEventListener('ravn:session-selected', handler);
  });
});
