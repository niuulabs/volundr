import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { PermissionDialog, PermissionStack } from './PermissionDialog';
import type { PermissionRequest } from '@/modules/volundr/hooks/useSkuldChat';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    request_id: 'req-abc-123',
    controlType: 'can_use_tool',
    tool: 'Bash',
    input: { command: 'rm -rf /tmp/test' },
    receivedAt: new Date('2026-01-15T10:00:00Z'),
    ...overrides,
  };
}

describe('PermissionDialog', () => {
  let onRespond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onRespond = vi.fn();
  });

  it('renders the permission request card', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    expect(screen.getByText('Permission Request')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('rm -rf /tmp/test')).toBeInTheDocument();
  });

  it('renders the tool badge with tool name', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'Write', input: { file_path: '/tmp/foo.txt' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('Write')).toBeInTheDocument();
    expect(screen.getByText('/tmp/foo.txt')).toBeInTheDocument();
  });

  it('shows file path summary for Read tool', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'Read', input: { file_path: '/etc/passwd' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('/etc/passwd')).toBeInTheDocument();
  });

  it('shows pattern summary for Glob tool', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'Glob', input: { pattern: '**/*.ts' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('**/*.ts')).toBeInTheDocument();
  });

  it('shows pattern summary for Grep tool', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'Grep', input: { pattern: 'TODO' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('TODO')).toBeInTheDocument();
  });

  it('shows URL summary for WebFetch tool', () => {
    render(
      <PermissionDialog
        request={makeRequest({
          tool: 'WebFetch',
          input: { url: 'https://example.com' },
        })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('https://example.com')).toBeInTheDocument();
  });

  it('shows URL summary for WebSearch tool', () => {
    render(
      <PermissionDialog
        request={makeRequest({
          tool: 'WebSearch',
          input: { url: 'https://search.example.com' },
        })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('https://search.example.com')).toBeInTheDocument();
  });

  it('handles unknown tool without summary', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'CustomTool', input: { custom: 'data' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('CustomTool')).toBeInTheDocument();
    // No summary shown for unknown tools with no recognizable fields
    expect(screen.getByText('Full details')).toBeInTheDocument();
  });

  it('calls onRespond with allow when Allow button clicked', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    fireEvent.click(screen.getByTestId('permission-allow'));

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('req-abc-123', 'allow');
  });

  it('calls onRespond with deny when Deny button clicked', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    fireEvent.click(screen.getByTestId('permission-deny'));

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('req-abc-123', 'deny');
  });

  it('calls onRespond with allowForever when Always Allow button clicked', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    fireEvent.click(screen.getByTestId('permission-allow-forever'));

    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(onRespond).toHaveBeenCalledWith('req-abc-123', 'allowForever');
  });

  it('toggles full details visibility', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    // Details not visible initially
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument();

    // Click to show details
    fireEvent.click(screen.getByText('Full details'));
    expect(screen.getByText(/"command"/)).toBeInTheDocument();

    // Click again to hide
    fireEvent.click(screen.getByText('Full details'));
    expect(screen.queryByText(/"command"/)).not.toBeInTheDocument();
  });

  it('hides details toggle when input is empty', () => {
    render(<PermissionDialog request={makeRequest({ input: {} })} onRespond={onRespond} />);

    expect(screen.queryByText('Full details')).not.toBeInTheDocument();
  });

  it('sets data-request-id attribute', () => {
    render(<PermissionDialog request={makeRequest()} onRespond={onRespond} />);

    const card = screen.getByTestId('permission-dialog');
    expect(card).toHaveAttribute('data-request-id', 'req-abc-123');
  });

  it('renders Edit tool with file path summary', () => {
    render(
      <PermissionDialog
        request={makeRequest({ tool: 'Edit', input: { file_path: '/src/main.ts' } })}
        onRespond={onRespond}
      />
    );

    expect(screen.getByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('/src/main.ts')).toBeInTheDocument();
  });
});

describe('PermissionStack', () => {
  let onRespond: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    onRespond = vi.fn();
  });

  it('renders nothing when permissions list is empty', () => {
    const { container } = render(<PermissionStack permissions={[]} onRespond={onRespond} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders a single permission card', () => {
    render(<PermissionStack permissions={[makeRequest()]} onRespond={onRespond} />);

    expect(screen.getByTestId('permission-stack')).toBeInTheDocument();
    expect(screen.getAllByTestId('permission-dialog')).toHaveLength(1);
  });

  it('renders multiple permission cards', () => {
    const permissions = [
      makeRequest({ request_id: 'req-1', tool: 'Bash', input: { command: 'ls' } }),
      makeRequest({ request_id: 'req-2', tool: 'Write', input: { file_path: '/tmp/x' } }),
      makeRequest({ request_id: 'req-3', tool: 'Read', input: { file_path: '/etc/hosts' } }),
    ];

    render(<PermissionStack permissions={permissions} onRespond={onRespond} />);

    expect(screen.getAllByTestId('permission-dialog')).toHaveLength(3);
  });

  it('passes onRespond to each card', () => {
    const permissions = [
      makeRequest({ request_id: 'req-1' }),
      makeRequest({ request_id: 'req-2' }),
    ];

    render(<PermissionStack permissions={permissions} onRespond={onRespond} />);

    const allowButtons = screen.getAllByTestId('permission-allow');
    fireEvent.click(allowButtons[0]);
    expect(onRespond).toHaveBeenCalledWith('req-1', 'allow');

    fireEvent.click(allowButtons[1]);
    expect(onRespond).toHaveBeenCalledWith('req-2', 'allow');
  });
});
