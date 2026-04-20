import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ServicesProvider } from '@niuulabs/plugin-sdk';
import { LaunchWizard } from './LaunchWizard';
import { createMockTemplateStore } from '../adapters/mock';

function wrap(open = true, onOpenChange = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const templateStore = createMockTemplateStore();
  return render(
    <QueryClientProvider client={client}>
      <ServicesProvider services={{ 'volundr.templates': templateStore }}>
        <LaunchWizard open={open} onOpenChange={onOpenChange} />
      </ServicesProvider>
    </QueryClientProvider>,
  );
}

describe('LaunchWizard', () => {
  it('renders when open', async () => {
    wrap();
    await waitFor(() => expect(screen.getByText('Launch pod')).toBeInTheDocument());
  });

  it('shows step indicator with 4 steps', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('step-indicator')).toBeInTheDocument());
    expect(screen.getByText('Template')).toBeInTheDocument();
    expect(screen.getByText('Source')).toBeInTheDocument();
    expect(screen.getByText('Runtime')).toBeInTheDocument();
    expect(screen.getByText('Confirm')).toBeInTheDocument();
  });

  it('shows template step content initially', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('step-template-content')).toBeInTheDocument());
    expect(screen.getByText('Choose a template')).toBeInTheDocument();
  });

  it('navigates to source step on continue', async () => {
    wrap();
    await waitFor(() => expect(screen.getByTestId('wizard-next')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('step-source-content')).toBeInTheDocument();
  });

  it('navigates back from source to template', async () => {
    wrap();
    await waitFor(() => fireEvent.click(screen.getByTestId('wizard-next')));
    expect(screen.getByTestId('step-source-content')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('wizard-back'));
    expect(screen.getByTestId('step-template-content')).toBeInTheDocument();
  });

  it('shows source type tabs', async () => {
    wrap();
    await waitFor(() => fireEvent.click(screen.getByTestId('wizard-next')));
    expect(screen.getByTestId('source-tab-git')).toBeInTheDocument();
    expect(screen.getByTestId('source-tab-local_mount')).toBeInTheDocument();
    expect(screen.getByTestId('source-tab-blank')).toBeInTheDocument();
  });

  it('shows runtime step with CLI options', async () => {
    wrap();
    // navigate to runtime (template -> source -> runtime)
    await waitFor(() => fireEvent.click(screen.getByTestId('wizard-next')));
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('step-runtime-content')).toBeInTheDocument();
    expect(screen.getByTestId('cli-option-claude')).toBeInTheDocument();
    expect(screen.getByTestId('cli-option-codex')).toBeInTheDocument();
  });

  it('shows confirm step with review rows', async () => {
    wrap();
    // navigate to confirm
    await waitFor(() => fireEvent.click(screen.getByTestId('wizard-next')));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    expect(screen.getByTestId('step-confirm-content')).toBeInTheDocument();
    expect(screen.getAllByTestId('confirm-row').length).toBeGreaterThan(0);
  });

  it('starts booting on forge session click', async () => {
    wrap();
    // navigate to confirm
    await waitFor(() => fireEvent.click(screen.getByTestId('wizard-next')));
    fireEvent.click(screen.getByTestId('wizard-next'));
    fireEvent.click(screen.getByTestId('wizard-next'));
    // Click forge
    fireEvent.click(screen.getByTestId('wizard-next'));
    await waitFor(() => expect(screen.getByTestId('step-booting-content')).toBeInTheDocument());
    expect(screen.getAllByTestId('boot-step').length).toBe(8);
  });

  it('does not render when closed', () => {
    wrap(false);
    expect(screen.queryByText('Launch pod')).not.toBeInTheDocument();
  });
});
