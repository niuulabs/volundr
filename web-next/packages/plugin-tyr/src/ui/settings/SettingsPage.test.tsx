import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { SettingsPage, SettingsIndexPage } from './SettingsPage';
import { createMockTyrSettingsService, createMockAuditLogService } from '../../adapters/mock';
import type { TyrPersonaSummary } from '../../ports';

const MOCK_PERSONA_STORE = {
  listPersonas: async () => [] as TyrPersonaSummary[],
  getPersonaYaml: async (_name: string) => '',
};

function wrap(services: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </QueryClientProvider>
    );
  };
}

const defaultServices = () => ({
  'tyr.settings': createMockTyrSettingsService(),
  'tyr.audit': createMockAuditLogService(),
  'ravn.personas': MOCK_PERSONA_STORE,
});

describe('SettingsIndexPage', () => {
  it('renders the index page heading', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider services={defaultServices()}>
          <SettingsIndexPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Tyr Settings')).toBeInTheDocument();
  });

  it('shows all 5 setting section links', () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ServicesProvider services={defaultServices()}>
          <SettingsIndexPage />
        </ServicesProvider>
      </QueryClientProvider>,
    );
    expect(screen.getByText('Personas')).toBeInTheDocument();
    expect(screen.getByText('Flock Config')).toBeInTheDocument();
    expect(screen.getByText('Dispatch Defaults')).toBeInTheDocument();
    expect(screen.getByText('Notifications')).toBeInTheDocument();
    expect(screen.getByText('Audit Log')).toBeInTheDocument();
  });
});

describe('SettingsPage', () => {
  it('renders PersonasSection for "personas" section', async () => {
    render(<SettingsPage section="personas" />, {
      wrapper: wrap(defaultServices()),
    });
    await waitFor(() => expect(screen.getByText('Personas')).toBeInTheDocument());
  });

  it('renders FlockConfigSection for "flock" section', async () => {
    render(<SettingsPage section="flock" />, {
      wrapper: wrap(defaultServices()),
    });
    await waitFor(() => expect(screen.getByText('Flock Config')).toBeInTheDocument());
  });

  it('renders DispatchDefaultsSection for "dispatch" section', async () => {
    render(<SettingsPage section="dispatch" />, {
      wrapper: wrap(defaultServices()),
    });
    await waitFor(() => expect(screen.getByText('Dispatch Defaults')).toBeInTheDocument());
  });

  it('renders NotificationsSection for "notifications" section', async () => {
    render(<SettingsPage section="notifications" />, {
      wrapper: wrap(defaultServices()),
    });
    await waitFor(() => expect(screen.getByText('Notifications')).toBeInTheDocument());
  });

  it('renders AuditLogSection for "audit" section', async () => {
    render(<SettingsPage section="audit" />, {
      wrapper: wrap(defaultServices()),
    });
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeInTheDocument());
  });
});
