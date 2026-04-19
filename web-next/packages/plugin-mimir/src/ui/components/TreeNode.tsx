import { useState } from 'react';
import { countLeaves } from '../../domain';
import { PageTypeGlyph } from './PageTypeGlyph';
import type { FileTreeItem } from '../../domain/tree';

/** Multiplier for each depth level's left-indent (in px, matches --mm-tree-indent-step CSS var). */
const TREE_INDENT_STEP = 12;

interface TreeNodeProps {
  node: FileTreeItem;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
}

export function TreeNode({ node, depth, selectedPath, onSelect }: TreeNodeProps) {
  const [open, setOpen] = useState(depth <= 1);

  if (!node.isDir) {
    const conf = node.page.confidence;
    return (
      <button
        type="button"
        className={`mm-tree-leaf${selectedPath === node.path ? ' mm-tree-leaf--active' : ''}`}
        style={{ '--mm-tree-depth': depth } as React.CSSProperties}
        onClick={() => onSelect(node.path)}
        aria-current={selectedPath === node.path ? 'page' : undefined}
      >
        <span className={`mm-conf-dot mm-conf-dot--${conf}`} aria-label={`confidence: ${conf}`} />
        <span className="mm-tree-leaf__name">{node.name}</span>
        <PageTypeGlyph type={node.page.type} size={TREE_INDENT_STEP - 1} />
      </button>
    );
  }

  const childCount = countLeaves(node);

  return (
    <div className="mm-tree-dir">
      <div
        className="mm-tree-dir-head"
        style={{ '--mm-tree-depth': depth } as React.CSSProperties}
        onClick={() => setOpen((o) => !o)}
        role="button"
        aria-expanded={open}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setOpen((o) => !o)}
      >
        <span className="mm-tree-caret">{open ? '▾' : '▸'}</span>
        <span>{node.name}/</span>
        <span className="mm-tree-dir-count">{childCount}</span>
      </div>
      {open &&
        Object.values(node.children).map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
          />
        ))}
    </div>
  );
}
