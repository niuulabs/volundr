import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MessageCostFooter } from './MessageCostFooter';
import type { ChatMessageMeta } from '@/hooks/useSkuldChat';

describe('MessageCostFooter', () => {
  it('renders nothing when metadata is undefined', () => {
    const { container } = render(<MessageCostFooter />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when usage is undefined', () => {
    const { container } = render(<MessageCostFooter metadata={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when all token counts are zero and no cost', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'test-model': {
          inputTokens: 0,
          outputTokens: 0,
        },
      },
    };
    const { container } = render(<MessageCostFooter metadata={metadata} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders token count from usage data', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'claude-opus-4-5-20251101': {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadInputTokens: 200,
          cacheCreationInputTokens: 0,
        },
      },
    };
    render(<MessageCostFooter metadata={metadata} />);

    expect(screen.getByText(/350/)).toBeInTheDocument();
    expect(screen.getByText(/tokens/)).toBeInTheDocument();
  });

  it('renders input/output breakdown', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'test-model': {
          inputTokens: 1000,
          outputTokens: 500,
        },
      },
    };
    render(<MessageCostFooter metadata={metadata} />);

    expect(screen.getByText(/in/)).toBeInTheDocument();
    expect(screen.getByText(/out/)).toBeInTheDocument();
  });

  it('renders cost when provided', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'test-model': {
          inputTokens: 100,
          outputTokens: 50,
        },
      },
      cost: 0.0527,
    };
    render(<MessageCostFooter metadata={metadata} />);

    expect(screen.getByText('$0.0527')).toBeInTheDocument();
  });

  it('sums tokens across multiple models', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'model-a': { inputTokens: 100, outputTokens: 50 },
        'model-b': { inputTokens: 200, outputTokens: 100 },
      },
    };
    render(<MessageCostFooter metadata={metadata} />);

    // 100 + 50 + 200 + 100 = 450
    expect(screen.getByText(/450/)).toBeInTheDocument();
  });

  it('handles missing individual token fields gracefully', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'test-model': {},
      },
      cost: 0.01,
    };
    render(<MessageCostFooter metadata={metadata} />);

    // No tokens but cost is shown
    expect(screen.getByText('$0.0100')).toBeInTheDocument();
  });

  it('applies custom className', () => {
    const metadata: ChatMessageMeta = {
      usage: {
        'test-model': { inputTokens: 100, outputTokens: 50 },
      },
    };
    const { container } = render(
      <MessageCostFooter metadata={metadata} className="custom-class" />
    );

    expect(container.firstChild).toHaveClass('custom-class');
  });
});
