import { Copy, Check } from 'lucide-react';
import { OutcomeCard, extractOutcomeBlock } from '../OutcomeCard';
import { useCopyFeedback } from '../../hooks/useCopyFeedback';
import './RenderedContent.css';

interface RenderedContentProps {
  content: string;
  className?: string;
}

function InlineCode({ children }: { children: string }) {
  const [copied, handleCopy] = useCopyFeedback(children);

  return (
    <div className="niuu-chat-rc-codeblock" data-testid="rendered-code-block">
      <div className="niuu-chat-rc-codeblock-header">
        <button type="button" className="niuu-chat-rc-copy-btn" onClick={handleCopy} title={copied ? 'Copied!' : 'Copy'}>
          {copied ? <Check className="niuu-chat-rc-copy-icon" /> : <Copy className="niuu-chat-rc-copy-icon" />}
        </button>
      </div>
      <pre className="niuu-chat-rc-pre">{children}</pre>
    </div>
  );
}

export function RenderedContent({ content, className }: RenderedContentProps) {
  // Check for outcome blocks first
  const outcome = extractOutcomeBlock(content);
  if (outcome) {
    return (
      <div className={className}>
        {outcome.before && <p className="niuu-chat-rc-p">{outcome.before}</p>}
        <OutcomeCard raw={outcome.raw} />
        {outcome.after && <p className="niuu-chat-rc-p">{outcome.after}</p>}
      </div>
    );
  }

  // Split code blocks
  const parts = content.split(/(```[\s\S]*?```)/g);

  return (
    <div className={className} data-testid="rendered-content">
      {parts.map((part, i) => {
        const codeMatch = /^```(\w*)\n?([\s\S]*?)```$/.exec(part.trim());
        if (codeMatch) {
          return <InlineCode key={i}>{codeMatch[2] ?? ''}</InlineCode>;
        }
        if (!part.trim()) return null;
        return <p key={i} className="niuu-chat-rc-p">{part}</p>;
      })}
    </div>
  );
}
