export interface ToolUseBlock {
  type: 'tool_use';
  id?: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id?: string;
  content?: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}

export type ContentBlock = ToolUseBlock | ToolResultBlock | TextBlock | { type: string };

export interface SingleBlock {
  kind: 'single';
  block: ToolUseBlock;
  result?: ToolResultBlock;
}

export interface GroupedBlocks {
  kind: 'group';
  toolName: string;
  blocks: { block: ToolUseBlock; result?: ToolResultBlock }[];
}

export interface TextSegment {
  kind: 'text';
  text: string;
}

export type GroupedContent = SingleBlock | GroupedBlocks | TextSegment;

/**
 * Groups consecutive same-name tool_use blocks into groups.
 * Text blocks pass through as-is.
 * tool_result blocks are attached to their preceding tool_use.
 */
export function groupContentBlocks(blocks: ContentBlock[]): GroupedContent[] {
  const result: GroupedContent[] = [];
  const pendingToolUses: { block: ToolUseBlock; result?: ToolResultBlock }[] = [];
  let currentToolName = '';

  function flushPending() {
    if (pendingToolUses.length === 0) return;

    if (pendingToolUses.length === 1) {
      result.push({ kind: 'single', ...pendingToolUses[0] });
    } else {
      result.push({
        kind: 'group',
        toolName: currentToolName,
        blocks: [...pendingToolUses],
      });
    }
    pendingToolUses.length = 0;
    currentToolName = '';
  }

  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const tu = block as ToolUseBlock;
      if (tu.name !== currentToolName) {
        flushPending();
        currentToolName = tu.name;
      }
      pendingToolUses.push({ block: tu });
      continue;
    }

    if (block.type === 'tool_result') {
      const tr = block as ToolResultBlock;
      // Attach to last pending tool_use
      if (pendingToolUses.length > 0) {
        pendingToolUses[pendingToolUses.length - 1].result = tr;
      }
      continue;
    }

    if (block.type === 'text') {
      flushPending();
      result.push({ kind: 'text', text: (block as TextBlock).text });
      continue;
    }

    // Unknown block type — flush and skip
    flushPending();
  }

  flushPending();
  return result;
}
