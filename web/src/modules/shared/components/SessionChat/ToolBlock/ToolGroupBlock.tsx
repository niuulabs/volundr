import { useState, useCallback } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/utils';
import { ToolIcon } from './ToolIcon';
import { getToolLabel, getToolCategory } from './toolLabels';
import { ToolBlock } from './ToolBlock';
import type { ToolUseBlock, ToolResultBlock } from './groupContentBlocks';
import styles from './ToolBlock.module.css';

interface ToolGroupBlockProps {
  toolName: string;
  blocks: { block: ToolUseBlock; result?: ToolResultBlock }[];
}

export function ToolGroupBlock({ toolName, blocks }: ToolGroupBlockProps) {
  const [expanded, setExpanded] = useState(false);

  const toggle = useCallback(() => setExpanded(prev => !prev), []);

  return (
    <div className={styles.groupBlock} data-tool-category={getToolCategory(toolName)}>
      <button type="button" className={styles.groupHeader} onClick={toggle}>
        <ToolIcon toolName={toolName} className={styles.toolIcon} />
        <span className={styles.toolLabel}>{getToolLabel(toolName)}</span>
        <span className={styles.countBadge}>{blocks.length}</span>
        <ChevronRight className={cn(styles.chevron, expanded && styles.chevronOpen)} />
      </button>
      {expanded && (
        <div className={styles.groupItems}>
          {blocks.map((item, i) => (
            <div key={item.block.id ?? i} className={styles.groupItem}>
              <ToolBlock block={item.block} result={item.result} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
