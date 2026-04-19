import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import { TemplatesPage } from './TemplatesPage';
import { renderWithVolundr } from '../testing/renderWithVolundr';
import { createMockTemplateStore } from '../adapters/mock';

describe('TemplatesPage', () => {
  it('renders the heading', () => {
    renderWithVolundr(<TemplatesPage />);
    expect(screen.getByRole('heading', { name: /templates/i })).toBeInTheDocument();
  });

  it('shows loading state before templates resolve', () => {
    const slowStore = {
      ...createMockTemplateStore(),
      listTemplates: () => new Promise<never>(() => {}),
    };
    renderWithVolundr(<TemplatesPage />, { templateStore: slowStore });
    expect(screen.getByText(/loading templates/)).toBeInTheDocument();
  });

  it('renders template cards after data loads', async () => {
    renderWithVolundr(<TemplatesPage />);
    await waitFor(() => expect(screen.getAllByTestId('template-card').length).toBeGreaterThan(0));
  });

  it('renders both seed templates', async () => {
    renderWithVolundr(<TemplatesPage />);
    await waitFor(() => expect(screen.getByText('default')).toBeInTheDocument());
    expect(screen.getByText('gpu-workload')).toBeInTheDocument();
  });

  it('shows empty state when no templates exist', async () => {
    const emptyStore = {
      ...createMockTemplateStore(),
      listTemplates: async () => [],
    };
    renderWithVolundr(<TemplatesPage />, { templateStore: emptyStore });
    await waitFor(() => expect(screen.getByText(/no templates yet/i)).toBeInTheDocument());
  });

  it('shows error state when service throws', async () => {
    const failStore = {
      ...createMockTemplateStore(),
      listTemplates: async () => {
        throw new Error('template service down');
      },
    };
    renderWithVolundr(<TemplatesPage />, { templateStore: failStore });
    await waitFor(() => expect(screen.getByText('template service down')).toBeInTheDocument());
  });

  it('has a "New Template" button', () => {
    renderWithVolundr(<TemplatesPage />);
    expect(screen.getByRole('button', { name: /new template/i })).toBeInTheDocument();
  });

  it('opens the editor drawer when New Template is clicked', async () => {
    renderWithVolundr(<TemplatesPage />);
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /new template/i })).toBeInTheDocument(),
    );
  });

  it('opens the editor drawer with Edit button', async () => {
    renderWithVolundr(<TemplatesPage />);
    await waitFor(() => expect(screen.getAllByTestId('template-card').length).toBeGreaterThan(0));
    const editBtns = screen.getAllByRole('button', { name: /edit template/i });
    fireEvent.click(editBtns[0]!);
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /edit template/i })).toBeInTheDocument(),
    );
  });

  it('clones a template when Clone is clicked', async () => {
    const store = createMockTemplateStore();
    const createSpy = vi.spyOn(store, 'createTemplate');
    renderWithVolundr(<TemplatesPage />, { templateStore: store });
    await waitFor(() => expect(screen.getAllByTestId('template-card').length).toBeGreaterThan(0));
    const cloneBtns = screen.getAllByRole('button', { name: /clone template/i });
    fireEvent.click(cloneBtns[0]!);
    await waitFor(() => expect(createSpy).toHaveBeenCalled());
    const [[name]] = createSpy.mock.calls;
    expect(name).toMatch(/^Clone of /);
  });

  it('validates that name is required when saving a new template', async () => {
    renderWithVolundr(<TemplatesPage />);
    fireEvent.click(screen.getByRole('button', { name: /new template/i }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /new template/i })).toBeInTheDocument(),
    );
    // Clear the name field and attempt save
    const nameInput = screen.getByPlaceholderText('e.g. default');
    fireEvent.change(nameInput, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save template/i }));
    await waitFor(() => expect(screen.getAllByText(/name is required/i).length).toBeGreaterThan(0));
  });

  it('shows secret ref keys but masks their values in cards', async () => {
    renderWithVolundr(<TemplatesPage />);
    await waitFor(() => expect(screen.getByText('gpu-workload')).toBeInTheDocument());
    // HF_TOKEN is a secret ref in the gpu-workload template
    expect(screen.getByText('HF_TOKEN')).toBeInTheDocument();
    expect(screen.getByText('***')).toBeInTheDocument();
  });
});
