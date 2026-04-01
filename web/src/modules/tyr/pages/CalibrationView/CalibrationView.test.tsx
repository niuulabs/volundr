import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CalibrationView } from './CalibrationView';

vi.mock('../../hooks/useCalibration', () => ({
  useCalibration: vi.fn(),
}));

import { useCalibration } from '../../hooks/useCalibration';

const mockCalibrationData = {
  window_days: 30,
  total_decisions: 100,
  auto_approved: 60,
  retried: 25,
  escalated: 15,
  divergence_rate: 0.03,
  avg_confidence_approved: 0.88,
  avg_confidence_reverted: 0.72,
  pending_resolution: 5,
};

const defaultHookResult = {
  data: mockCalibrationData,
  loading: false,
  error: null,
  windowDays: 30,
  setWindowDays: vi.fn(),
  reviewerPrompt: '',
  promptLoading: false,
  savingPrompt: false,
  loadPrompt: vi.fn(),
  savePrompt: vi.fn(),
};

describe('CalibrationView', () => {
  beforeEach(() => {
    vi.mocked(useCalibration).mockReturnValue({ ...defaultHookResult });
  });

  it('renders stats row with all counts', () => {
    render(<CalibrationView />);
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('renders divergence badge with green band for rate < 5%', () => {
    render(<CalibrationView />);
    const badge = screen.getByText('3.0%');
    expect(badge).toBeInTheDocument();
    expect(badge.getAttribute('data-band')).toBe('green');
  });

  it('renders divergence badge with amber band for rate 5-15%', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: { ...mockCalibrationData, divergence_rate: 0.10 },
    });
    render(<CalibrationView />);
    const badge = screen.getByText('10.0%');
    expect(badge.getAttribute('data-band')).toBe('amber');
  });

  it('renders divergence badge with red band for rate > 15%', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: { ...mockCalibrationData, divergence_rate: 0.25 },
    });
    render(<CalibrationView />);
    const badge = screen.getByText('25.0%');
    expect(badge.getAttribute('data-band')).toBe('red');
  });

  it('renders empty state when total_decisions is 0', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: { ...mockCalibrationData, total_decisions: 0 },
    });
    render(<CalibrationView />);
    expect(screen.getByText('No reviewer decisions recorded yet')).toBeInTheDocument();
  });

  it('renders empty state when data is null', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: null,
    });
    render(<CalibrationView />);
    expect(screen.getByText('No reviewer decisions recorded yet')).toBeInTheDocument();
  });

  it('renders loading state', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: null,
      loading: true,
    });
    render(<CalibrationView />);
    expect(screen.getByText(/Loading calibration data/)).toBeInTheDocument();
  });

  it('renders error state', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      data: null,
      error: 'Connection failed',
    });
    render(<CalibrationView />);
    expect(screen.getByText('Connection failed')).toBeInTheDocument();
  });

  it('renders window selector buttons', () => {
    render(<CalibrationView />);
    expect(screen.getByText('7d')).toBeInTheDocument();
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
  });

  it('calls setWindowDays when window button is clicked', () => {
    const setWindowDays = vi.fn();
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      setWindowDays,
    });
    render(<CalibrationView />);
    fireEvent.click(screen.getByText('7d'));
    expect(setWindowDays).toHaveBeenCalledWith(7);
  });

  it('renders confidence delta text', () => {
    render(<CalibrationView />);
    expect(screen.getByText('0.88')).toBeInTheDocument();
    expect(screen.getByText('0.72')).toBeInTheDocument();
  });

  it('renders prompt editor toggle', () => {
    render(<CalibrationView />);
    expect(screen.getByText(/Reviewer Prompt Editor/)).toBeInTheDocument();
  });

  it('loads prompt on first toggle open', () => {
    const loadPrompt = vi.fn();
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      loadPrompt,
    });
    render(<CalibrationView />);
    fireEvent.click(screen.getByText(/Reviewer Prompt Editor/));
    expect(loadPrompt).toHaveBeenCalled();
  });

  it('renders textarea when prompt editor is open', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      reviewerPrompt: 'test prompt content',
    });
    render(<CalibrationView />);
    fireEvent.click(screen.getByText(/Reviewer Prompt Editor/));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('save button is disabled when prompt has not changed', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      reviewerPrompt: 'original prompt',
    });
    render(<CalibrationView />);
    fireEvent.click(screen.getByText(/Reviewer Prompt Editor/));
    const saveBtn = screen.getByText('Save');
    expect(saveBtn).toBeDisabled();
  });

  it('save button is enabled after editing prompt', () => {
    vi.mocked(useCalibration).mockReturnValue({
      ...defaultHookResult,
      reviewerPrompt: 'original prompt',
    });
    render(<CalibrationView />);
    fireEvent.click(screen.getByText(/Reviewer Prompt Editor/));
    const textarea = screen.getByRole('textbox');
    fireEvent.change(textarea, { target: { value: 'modified prompt' } });
    const saveBtn = screen.getByText('Save');
    expect(saveBtn).not.toBeDisabled();
  });
});
