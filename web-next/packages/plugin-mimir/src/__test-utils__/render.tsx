import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { createMimirMockAdapter } from '../adapters/mock';
import type { IMimirService } from '../ports';

export function renderWithProviders(ui: React.ReactNode, service?: IMimirService) {
  const svc = service ?? createMimirMockAdapter();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ mimir: svc }}>{ui}</ServicesProvider>
    </QueryClientProvider>,
  );
}
