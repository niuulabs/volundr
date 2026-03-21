import { useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { ToolIcon } from './ToolIcon';
import { getToolLabel } from './toolLabels';
import type { ToolUseBlock, ToolResultBlock } from './groupContentBlocks';
import styles from './ToolBlock.module.css';

/* ------------------------------------------------------------------ */
/*  Preview text extraction                                            */
/* ------------------------------------------------------------------ */

function getPreviewText(toolName: string, input: Record<string, unknown>): string {
  switch (toolName) {
    case 'Bash': {
      const desc = input.description as string | undefined;
      const cmd = input.command as string | undefined;
      const text = desc && desc.length < 60 ? desc : (cmd ?? '');
      return text.length > 60 ? text.slice(0, 57) + '...' : text;
    }
    case 'Read':
    case 'Write':
    case 'Edit': {
      const path = (input.file_path ?? input.path ?? '') as string;
      const parts = path.split('/').filter(Boolean);
      return parts.slice(-2).join('/');
    }
    case 'Glob':
      return (input.pattern ?? '') as string;
    case 'Grep':
      return `${input.pattern ?? ''} ${input.path ?? ''}`.trim();
    case 'WebSearch':
      return (input.query ?? '') as string;
    case 'WebFetch':
      return (input.url ?? '') as string;
    case 'Agent':
      return (input.description ?? '') as string;
    default: {
      // MCP tools
      if (toolName.startsWith('mcp__')) {
        return toolName.replace(/__/g, ':');
      }
      const firstValue = Object.values(input)[0];
      if (typeof firstValue === 'string') {
        return firstValue.length > 60 ? firstValue.slice(0, 57) + '...' : firstValue;
      }
      return '';
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Detail views                                                        */
/* ------------------------------------------------------------------ */

interface DetailProps {
  toolName: string;
  input: Record<string, unknown>;
  result?: ToolResultBlock;
}

function ToolDetail({ toolName, input, result }: DetailProps) {
  const [showFull, setShowFull] = useState(false);

  const output = result?.content ?? '';
  const outputLines = output.split('\n');
  const truncated = !showFull && outputLines.length > 20;
  const displayOutput = truncated ? outputLines.slice(-20).join('\n') : output;

  if (toolName === 'Bash') {
    return (
      <div className={styles.toolDetail}>
        <div className={styles.commandLine}>
          <span className={styles.commandPrefix}>$ </span>
          {String(input.command)}
        </div>
        {!!input.description && (
          <div className={styles.paramRow}>
            <span className={styles.paramValue}>{String(input.description)}</span>
          </div>
        )}
        {output && (
          <div className={styles.outputSection}>
            <div className={styles.outputLabel}>Output</div>
            <div className={styles.outputContent}>{displayOutput}</div>
            {truncated && (
              <button
                type="button"
                className={styles.showFullBtn}
                onClick={() => setShowFull(true)}
              >
                Show full output ({outputLines.length} lines)
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  if (toolName === 'Edit') {
    return (
      <div className={styles.toolDetail}>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>file:</span>
          <span className={styles.paramValue}>{String(input.file_path)}</span>
        </div>
        {!!input.old_string && (
          <>
            <div className={styles.diffLabel}>Old</div>
            <div className={styles.diffOld}>{String(input.old_string)}</div>
          </>
        )}
        {!!input.new_string && (
          <>
            <div className={styles.diffLabel}>New</div>
            <div className={styles.diffNew}>{String(input.new_string)}</div>
          </>
        )}
      </div>
    );
  }

  if (toolName === 'Write') {
    const content = String(input.content ?? '');
    const preview = content.length > 500 ? content.slice(0, 500) + '\n...' : content;
    return (
      <div className={styles.toolDetail}>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>file:</span>
          <span className={styles.paramValue}>{String(input.file_path)}</span>
        </div>
        <div className={styles.diffNew}>{preview}</div>
      </div>
    );
  }

  if (toolName === 'Read') {
    return (
      <div className={styles.toolDetail}>
        <div className={styles.paramRow}>
          <span className={styles.paramLabel}>file:</span>
          <span className={styles.paramValue}>{String(input.file_path)}</span>
        </div>
        {!!input.offset && (
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>offset:</span>
            <span className={styles.paramValue}>{String(input.offset)}</span>
          </div>
        )}
        {!!input.limit && (
          <div className={styles.paramRow}>
            <span className={styles.paramLabel}>limit:</span>
            <span className={styles.paramValue}>{String(input.limit)}</span>
          </div>
        )}
      </div>
    );
  }

  // Generic fallback: show all params
  return (
    <div className={styles.toolDetail}>
      {Object.entries(input).map(([key, value]) => (
        <div key={key} className={styles.paramRow}>
          <span className={styles.paramLabel}>{key}:</span>
          <span className={styles.paramValue}>
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  ToolBlock                                                           */
/* ------------------------------------------------------------------ */

interface ToolBlockProps {
  block: ToolUseBlock;
  result?: ToolResultBlock;
}

export function ToolBlock({ block, result }: ToolBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded(prev => !prev), []);

  return (
    <div className={styles.toolBlock}>
      <button type="button" className={styles.toolHeader} onClick={toggle}>
        <ToolIcon toolName={block.name} className={styles.toolIcon} />
        <span className={styles.toolLabel}>{getToolLabel(block.name)}</span>
        <span className={styles.toolPreview}>{getPreviewText(block.name, block.input)}</span>
        <ChevronRight className={cn(styles.chevron, expanded && styles.chevronOpen)} />
      </button>
      {expanded && <ToolDetail toolName={block.name} input={block.input} result={result} />}
    </div>
  );
}
