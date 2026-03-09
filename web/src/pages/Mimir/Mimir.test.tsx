import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MimirPage } from './index';

vi.mock('@/hooks', () => ({
  useMimir: vi.fn(),
}));

import { useMimir } from '@/hooks';

const mockStats = {
  consultationsToday: 7,
  totalConsultations: 423,
  tokensUsedToday: 45600,
  costToday: 3.42,
  avgResponseTime: 2.4,
};

const mockConsultations = [
  {
    id: 'cons-1',
    topic: 'Kubernetes pod autoscaling',
    query: 'What are the best practices for configuring HPA in production?',
    response: 'For production HPA configuration, consider these key factors...',
    requester: 'odin',
    time: '14:23',
    tokensIn: 245,
    tokensOut: 1847,
    latency: 2.3,
    useful: true,
  },
  {
    id: 'cons-2',
    topic: 'Database migration strategy',
    query: 'How should I handle zero-downtime PostgreSQL migrations?',
    response: 'Zero-downtime migrations require careful planning...',
    requester: 'brunhilde',
    time: '13:45',
    tokensIn: 189,
    tokensOut: 2156,
    latency: 2.8,
    useful: true,
  },
  {
    id: 'cons-3',
    topic: 'API rate limiting',
    query: 'What rate limiting algorithm should I use for burst traffic?',
    response: 'For burst traffic handling, consider token bucket or leaky bucket...',
    requester: 'skuld-alpha',
    time: '12:30',
    tokensIn: 156,
    tokensOut: 1234,
    latency: 1.9,
    useful: null,
  },
];

describe('MimirPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows loading state when loading', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: null,
      consultations: [],
      loading: true,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows loading state when stats is null', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: null,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('renders page title and subtitle', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText("Mímir's Well")).toBeInTheDocument();
    expect(
      screen.getByText("Deep wisdom from Claude — when ODIN's knowledge is not enough")
    ).toBeInTheDocument();
  });

  it('renders Claude model badge', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Claude 3 Opus')).toBeInTheDocument();
  });

  it('renders metrics cards with stats', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Today')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('All Time')).toBeInTheDocument();
    expect(screen.getByText('423')).toBeInTheDocument();
    expect(screen.getByText('Tokens Today')).toBeInTheDocument();
    expect(screen.getByText('45.6k')).toBeInTheDocument();
    expect(screen.getByText('Cost Today')).toBeInTheDocument();
    expect(screen.getByText('$3.42')).toBeInTheDocument();
    expect(screen.getByText('Avg Latency')).toBeInTheDocument();
    expect(screen.getByText('2.4s')).toBeInTheDocument();
  });

  it('renders usefulness percentage', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Usefulness')).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument(); // 2 out of 3 marked useful
  });

  it('renders description box', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('The Well of Wisdom')).toBeInTheDocument();
    expect(
      screen.getByText(/When ODIN encounters questions beyond his knowledge/)
    ).toBeInTheDocument();
  });

  it('renders consultation cards', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Recent Consultations')).toBeInTheDocument();
    expect(screen.getByText('Kubernetes pod autoscaling')).toBeInTheDocument();
    expect(screen.getByText('Database migration strategy')).toBeInTheDocument();
    expect(screen.getByText('API rate limiting')).toBeInTheDocument();
  });

  it('shows detail panel placeholder when no consultation selected', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Select a consultation to view details')).toBeInTheDocument();
  });

  it('selects consultation when clicked', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);

    // Click on the consultation topic text directly - the card has onClick
    const topicElement = screen.getByText('Kubernetes pod autoscaling');
    const card =
      topicElement.closest('[class*="card"]') || topicElement.parentElement?.parentElement;
    fireEvent.click(card || topicElement);

    // Detail panel should show query - may appear multiple times
    expect(
      screen.getAllByText(/What are the best practices for configuring HPA/).length
    ).toBeGreaterThanOrEqual(1);
  });

  it('renders detail panel with selected consultation info', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);

    const topicElement = screen.getByText('Kubernetes pod autoscaling');
    const card =
      topicElement.closest('[class*="card"]') || topicElement.parentElement?.parentElement;
    fireEvent.click(card || topicElement);

    expect(screen.getAllByText('Query').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Response').length).toBeGreaterThanOrEqual(1);
  });

  it('shows requester in detail panel', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: mockConsultations,
      loading: false,
      error: null,
    });

    render(<MimirPage />);

    const topicElement = screen.getByText('Kubernetes pod autoscaling');
    const card =
      topicElement.closest('[class*="card"]') || topicElement.parentElement?.parentElement;
    fireEvent.click(card || topicElement);

    expect(screen.getAllByText(/Requested by odin/).length).toBeGreaterThanOrEqual(1);
  });

  it('handles empty consultations list', () => {
    vi.mocked(useMimir).mockReturnValue({
      stats: mockStats,
      consultations: [],
      loading: false,
      error: null,
    });

    render(<MimirPage />);
    expect(screen.getByText('Recent Consultations')).toBeInTheDocument();
    // Usefulness should be 0%
    expect(screen.getByText('0%')).toBeInTheDocument();
  });
});
