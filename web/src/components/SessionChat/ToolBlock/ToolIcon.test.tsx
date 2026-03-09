import { render } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ToolIcon } from './ToolIcon';

describe('ToolIcon', () => {
  it('renders an SVG element', () => {
    const { container } = render(<ToolIcon toolName="Bash" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('applies the provided className', () => {
    const { container } = render(<ToolIcon toolName="Bash" className="my-icon" />);
    const svg = container.querySelector('svg');
    expect(svg?.classList.contains('my-icon')).toBe(true);
  });

  it('renders for known tool names without crashing', () => {
    const knownTools = [
      'Bash',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
      'Agent',
      'TaskCreate',
      'TaskUpdate',
      'TodoWrite',
    ];
    for (const tool of knownTools) {
      const { container } = render(<ToolIcon toolName={tool} />);
      expect(container.querySelector('svg')).toBeTruthy();
    }
  });

  it('renders fallback icon for unknown tool name', () => {
    const { container } = render(<ToolIcon toolName="UnknownTool" />);
    expect(container.querySelector('svg')).toBeTruthy();
  });
});
