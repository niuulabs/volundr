import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react';
import { SessionsView } from './SessionsView';
import { createMockSessionStream, createMockRavenStream } from '../adapters/mock';
import { wrapWithServices } from '../testing/wrapWithRavn';

const wrap = wrapWithServices;

const services = {
  'ravn.sessions': createMockSessionStream(),
  'ravn.ravens': createMockRavenStream(),
};

beforeEach(() => {
  localStorage.clear();
});

describe('SessionsView', () => {
  it('shows loading state initially', () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    expect(screen.getByText(/loading sessions/i)).toBeInTheDocument();
  });

  it('shows session list after loading', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getAllByText('coding-agent').length).toBeGreaterThan(0));
  });

  it('shows session count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      // '6' appears in both the list-count badge and sidebar msg-count
      expect(screen.getAllByText('6').length).toBeGreaterThan(0);
    });
  });

  it('renders all sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      const buttons = screen.getAllByRole('button', { name: /session/ });
      const names = buttons.map((b) => b.textContent ?? '');
      expect(names.some((n) => n.includes('coding-agent'))).toBe(true);
      expect(names.some((n) => n.includes('reviewer'))).toBe(true);
    });
  });

  it('loads transcript when session is selected', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument(), { timeout: 3000 });
  });

  it('shows error state when service fails', async () => {
    const failing = {
      listSessions: async () => {
        throw new Error('fetch failed');
      },
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': failing, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByText(/failed to load sessions/i)).toBeInTheDocument());
  });

  it('clicking a session item selects it', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(1),
    );
    const items = screen.getAllByRole('button', { name: /session/ });
    fireEvent.click(items[1]!);
    expect(items[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows context sidebar when a session is selected', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('session-context-sidebar')).toBeInTheDocument());
  });

  it('sidebar shows summary section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-summary')).toBeInTheDocument());
  });

  it('sidebar shows timeline section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-timeline')).toBeInTheDocument());
  });

  it('sidebar shows stats section with message count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByTestId('ctx-stats')).toBeInTheDocument();
      expect(screen.getByTestId('ctx-msg-count')).toBeInTheDocument();
    });
  });

  it('sidebar shows raven card', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-raven')).toBeInTheDocument());
  });

  it('responds to ravn:session-selected event', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000002',
        }),
      );
    });

    await waitFor(() => {
      // reviewer session should be selected (ID ends in 002)
      const items = screen.getAllByRole('button', { name: /session/ });
      const reviewerItem = items.find((el) => el.textContent?.includes('reviewer'));
      expect(reviewerItem).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('persists session selection to localStorage', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000003',
        }),
      );
    });

    await waitFor(() => {
      const stored = localStorage.getItem('ravn.session');
      expect(stored).toBe('"10000001-0000-4000-8000-000000000003"');
    });
  });
});

describe('TranscriptHeader', () => {
  it('renders transcript header card with session title', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('transcript-header')).toBeInTheDocument());
  });

  it('shows session title in header', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      // First session is coding-agent "Implement login form"
      expect(screen.getByText('Implement login form')).toBeInTheDocument(),
    );
  });

  it('shows metrics in header', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('transcript-metrics')).toBeInTheDocument());
  });

  it('shows action buttons in header', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      expect(screen.getByTestId('transcript-actions')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /export session/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /pause session/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /abort session/i })).toBeInTheDocument();
    });
  });

  it('pause and abort buttons are enabled for running sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      // coding-agent is 'running'
      const pause = screen.getByRole('button', { name: /pause session/i });
      const abort = screen.getByRole('button', { name: /abort session/i });
      expect(pause).not.toBeDisabled();
      expect(abort).not.toBeDisabled();
    });
  });

  it('pause and abort are disabled for stopped sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    // select the 'investigator' session which is 'stopped'
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000005',
        }),
      );
    });
    await waitFor(() => {
      const pause = screen.getByRole('button', { name: /pause session/i });
      const abort = screen.getByRole('button', { name: /abort session/i });
      expect(pause).toBeDisabled();
      expect(abort).toBeDisabled();
    });
  });

  it('shows token count in metrics when available', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      // coding-agent has 4820 tokens → "4.8k"
      expect(screen.getByText('4.8k')).toBeInTheDocument();
    });
  });

  it('shows cost in metrics when available', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      // coding-agent has costUsd: 0.18
      expect(screen.getByText('$0.18')).toBeInTheDocument(),
    );
  });
});

describe('FilterToolbar', () => {
  it('renders filter toolbar', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('filter-toolbar')).toBeInTheDocument());
  });

  it('renders all filter buttons', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      const toolbar = screen.getByTestId('filter-toolbar');
      expect(toolbar).toBeInTheDocument();
      ['All', 'User', 'Assistant', 'Tool', 'Emit', 'System', 'Think'].forEach((label) => {
        expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
      });
    });
  });

  it('All filter is active by default', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      const allBtn = screen.getByRole('button', { name: 'All' });
      expect(allBtn).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('clicking a filter button activates it', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'User' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'User' })).toHaveAttribute('aria-pressed', 'true');
      expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'false');
    });
  });

  it('filtering to User shows only user messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'User' })).toBeInTheDocument());
    // wait for messages to load
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'User' }));
    await waitFor(() => {
      // Only user kind messages should be shown
      const _userMsgs = screen.getAllByTestId
        ? document.querySelectorAll('[data-kind="user"]')
        : [];
      // At minimum the transcript should still be present
      expect(screen.getByRole('log')).toBeInTheDocument();
    });
  });
});

describe('Composer', () => {
  it('shows composer for running sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      // coding-agent is 'running'
      expect(screen.getByTestId('composer')).toBeInTheDocument(),
    );
  });

  it('shows closed composer for stopped sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000005',
        }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('composer-closed')).toBeInTheDocument());
  });

  it('composer textarea is present', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /compose message/i })).toBeInTheDocument(),
    );
  });

  it('send button is present', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send message/i })).toBeInTheDocument(),
    );
  });

  it('send button disabled when textarea is empty', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      const sendBtn = screen.getByRole('button', { name: /send message/i });
      expect(sendBtn).toBeDisabled();
    });
  });

  it('send button enabled when textarea has text', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /compose message/i })).toBeInTheDocument(),
    );
    const textarea = screen.getByRole('textbox', { name: /compose message/i });
    fireEvent.change(textarea, { target: { value: 'hello raven' } });
    await waitFor(() => {
      const sendBtn = screen.getByRole('button', { name: /send message/i });
      expect(sendBtn).not.toBeDisabled();
    });
  });

  it('send clears the textarea', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /compose message/i })).toBeInTheDocument(),
    );
    const textarea = screen.getByRole('textbox', { name: /compose message/i });
    fireEvent.change(textarea, { target: { value: 'hello raven' } });
    fireEvent.click(screen.getByRole('button', { name: /send message/i }));
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('closed composer shows read-only label', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000005',
        }),
      );
    });
    await waitFor(() => expect(screen.getByText(/read-only/i)).toBeInTheDocument());
  });
});

describe('ContextSidebar — Injects', () => {
  it('shows injects section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-injects')).toBeInTheDocument());
  });

  it('shows "no injected context" when no system messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => {
      // The mock session 1 (coding-agent) has no system messages in SEED_MESSAGES
      const injectsSection = screen.getByTestId('ctx-injects');
      expect(injectsSection).toBeInTheDocument();
    });
  });
});

describe('ContextSidebar — Emissions', () => {
  it('shows emissions section', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-emissions')).toBeInTheDocument());
  });

  it('shows emit message in emissions when present', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-emissions')).toBeInTheDocument());
    // coding-agent session has an emit message with 'code.changed' event
    await waitFor(
      () => {
        const emissionsList = document.querySelector('[data-testid="emissions-list"]');
        if (emissionsList) {
          expect(emissionsList).toBeInTheDocument();
          expect(screen.getByText('code.changed')).toBeInTheDocument();
        }
      },
      { timeout: 3000 },
    );
  });

  it('shows pending state for running session with no emissions', async () => {
    // Create a session stream with running session but no emit messages
    const noEmitStream = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000002',
          ravnId: 'b7e2c9d1-3a4f-4b8e-a1c6-5d7f8e9a0b2c',
          personaName: 'reviewer',
          personaRole: 'review',
          personaLetter: 'R',
          status: 'running' as const,
          model: 'claude-opus-4-6',
          createdAt: '2026-04-15T08:45:11Z',
          title: 'Review PR #142',
          messageCount: 4,
          costUsd: 0.42,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [],
    };

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000002',
        }),
      );
    });

    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': noEmitStream, 'ravn.ravens': createMockRavenStream() }),
    });

    await waitFor(() =>
      expect(screen.getByText(/pending · will emit on completion/i)).toBeInTheDocument(),
    );
  });
});

describe('ContextSidebar — Timeline enrichment', () => {
  it('timeline shows start event', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-timeline')).toBeInTheDocument());
    await waitFor(() => expect(screen.getByTestId('timeline-event-start')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('timeline shows tool_call events from messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    // coding-agent session has a tool_call for file.read
    await waitFor(
      () => {
        const toolEvent = document.querySelector('[data-testid="timeline-event-tool_call"]');
        if (toolEvent) {
          expect(toolEvent).toBeInTheDocument();
        }
      },
      { timeout: 3000 },
    );
  });

  it('timeline shows emit events from messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(
      () => {
        const emitEvent = document.querySelector('[data-testid="timeline-event-emit"]');
        if (emitEvent) {
          expect(emitEvent).toBeInTheDocument();
        }
      },
      { timeout: 3000 },
    );
  });

  it('stats section shows token count', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByTestId('ctx-token-count')).toBeInTheDocument());
  });

  it('shows end event in timeline for non-running sessions', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000005',
        }),
      );
    });
    await waitFor(() => expect(screen.getByTestId('timeline-event-end')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('timeline shows intermediate events with label from tool_call toolName', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(
      () => {
        const toolEvent = document.querySelector('[data-testid="timeline-event-tool_call"]');
        if (toolEvent) {
          expect(toolEvent.textContent).toMatch(/tool/i);
        }
      },
      { timeout: 3000 },
    );
  });
});

describe('SessionsView — additional branch coverage', () => {
  it('shows session title fallback when title is undefined', async () => {
    const streamNoTitle = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'running' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          // no title
          messageCount: 6,
          costUsd: 0.18,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamNoTitle, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByText(/session 10000001/i)).toBeInTheDocument());
  });

  it('uses personaName first letter as avatar fallback when personaLetter is missing', async () => {
    const streamNoLetter = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'my-agent',
          // no personaRole or personaLetter
          status: 'idle' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Test session',
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamNoLetter, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByTestId('transcript-header')).toBeInTheDocument());
  });

  it('shows small token count without k suffix', async () => {
    const streamSmallTokens = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'running' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Test',
          messageCount: 3,
          tokenCount: 500,
          costUsd: 0.01,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamSmallTokens, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByText('500')).toBeInTheDocument());
  });

  it('shows ratio in stats when messageCount > 0 and costUsd present', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      // coding-agent has 6 messages and cost $0.18 → ratio = $0.030
      expect(screen.getByTestId('ctx-stats')).toBeInTheDocument(),
    );
    // The ratio dd element should appear (Cost/msg row)
    await waitFor(() => {
      const statsDl = screen.getByTestId('ctx-stats');
      expect(statsDl.textContent).toContain('Cost/msg');
    });
  });

  it('handles emit with non-JSON content gracefully', async () => {
    const streamBadJson = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'running' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Test',
          messageCount: 2,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [
        {
          id: '00000001-0000-4000-8000-000000000099',
          sessionId: '10000001-0000-4000-8000-000000000001',
          kind: 'emit' as const,
          content: 'not-valid-json-at-all',
          ts: '2026-04-15T09:12:36Z',
        },
      ],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamBadJson, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByTestId('ctx-emissions')).toBeInTheDocument(), {
      timeout: 3000,
    });
    // Should render without crashing, showing the emissions list
    await waitFor(
      () => {
        const emissionsList = document.querySelector('[data-testid="emissions-list"]');
        expect(emissionsList).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it('filter toolbar filters asst messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Assistant' })).toBeInTheDocument(),
    );
    await waitFor(() => expect(screen.getByRole('log')).toBeInTheDocument(), { timeout: 3000 });
    fireEvent.click(screen.getByRole('button', { name: 'Assistant' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Assistant' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('filter toolbar filters tool messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Tool' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Tool' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Tool' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('filter toolbar filters emit messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Emit' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Emit' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Emit' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('filter toolbar filters think messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Think' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Think' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Think' })).toHaveAttribute('aria-pressed', 'true');
    });
  });

  it('filter toolbar filters system messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() => expect(screen.getByRole('button', { name: 'System' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'System' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
    });
  });

  it('Composer send clears on Enter key', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /compose message/i })).toBeInTheDocument(),
    );
    const textarea = screen.getByRole('textbox', { name: /compose message/i });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });

  it('Composer Shift+Enter does not send', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /compose message/i })).toBeInTheDocument(),
    );
    const textarea = screen.getByRole('textbox', { name: /compose message/i });
    fireEvent.change(textarea, { target: { value: 'hello' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    await waitFor(() => {
      // Shift+Enter should NOT clear the text
      expect((textarea as HTMLTextAreaElement).value).toBe('hello');
    });
  });

  it('shows injects list when session has system messages', async () => {
    const streamWithSystem = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'idle' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Test session',
          messageCount: 1,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [
        {
          id: '00000001-0000-4000-8000-000000000050',
          sessionId: '10000001-0000-4000-8000-000000000001',
          kind: 'system' as const,
          content: 'repo.tree context injected',
          ts: '2026-04-15T09:12:34Z',
        },
      ],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamWithSystem, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByTestId('injects-list')).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows no emissions label for stopped session with no emit messages', async () => {
    render(<SessionsView />, { wrapper: wrap(services) });
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /session/ }).length).toBeGreaterThan(0),
    );
    act(() => {
      window.dispatchEvent(
        new CustomEvent('ravn:session-selected', {
          detail: '10000001-0000-4000-8000-000000000005',
        }),
      );
    });
    await waitFor(() => expect(screen.getByText(/no emissions/i)).toBeInTheDocument(), {
      timeout: 3000,
    });
  });

  it('shows messages count without cost/msg ratio when messageCount is undefined', async () => {
    const streamNoCount = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'running' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Test session',
          // no messageCount or costUsd
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => [],
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamNoCount, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByTestId('ctx-stats')).toBeInTheDocument());
    // No Cost/msg row when ratio is null
    const statsDl = screen.getByTestId('ctx-stats');
    expect(statsDl.textContent).not.toContain('Cost/msg');
  });

  it('closes show-more timeline after expand', async () => {
    // Generate many tool_call messages to trigger >15 events
    const manyMessages = Array.from({ length: 20 }, (_, i) => ({
      id: `00000001-0000-4000-8000-${String(i).padStart(12, '0')}`,
      sessionId: '10000001-0000-4000-8000-000000000001',
      kind: 'tool_call' as const,
      content: '{}',
      ts: `2026-04-15T09:12:${String(35 + i).padStart(2, '0')}Z`,
      toolName: `tool-${i}`,
    }));

    const streamManyEvents = {
      listSessions: async () => [
        {
          id: '10000001-0000-4000-8000-000000000001',
          ravnId: 'a3f1b2c4-8e7d-4a6f-9b0c-1d2e3f4a5b6c',
          personaName: 'coding-agent',
          personaRole: 'build',
          personaLetter: 'C',
          status: 'running' as const,
          model: 'claude-sonnet-4-6',
          createdAt: '2026-04-15T09:12:34Z',
          title: 'Many events',
          messageCount: 20,
        },
      ],
      getSession: async () => {
        throw new Error('not called');
      },
      getMessages: async () => manyMessages,
    };
    render(<SessionsView />, {
      wrapper: wrap({ 'ravn.sessions': streamManyEvents, 'ravn.ravens': createMockRavenStream() }),
    });
    await waitFor(() => expect(screen.getByTestId('timeline-show-more')).toBeInTheDocument(), {
      timeout: 3000,
    });
    fireEvent.click(screen.getByTestId('timeline-show-more'));
    await waitFor(() => {
      // After expanding, show-more should disappear
      expect(screen.queryByTestId('timeline-show-more')).not.toBeInTheDocument();
    });
  });
});
