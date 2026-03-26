import { useState, type FC } from 'react';
import {
  ShieldAlertIcon,
  TerminalIcon,
  FileEditIcon,
  FolderSearchIcon,
  SearchIcon,
  FileTextIcon,
  GlobeIcon,
  CheckIcon,
  XIcon,
  ChevronRightIcon,
  ShieldCheckIcon,
} from 'lucide-react';
import type { PermissionRequest, PermissionBehavior } from '@/modules/shared/hooks/useSkuldChat';
import styles from './PermissionDialog.module.css';

function ToolBadgeIcon({ tool }: { tool: string }) {
  switch (tool) {
    case 'Bash':
      return <TerminalIcon className={styles.toolIcon} />;
    case 'Write':
    case 'Edit':
      return <FileEditIcon className={styles.toolIcon} />;
    case 'Read':
      return <FileTextIcon className={styles.toolIcon} />;
    case 'Glob':
      return <FolderSearchIcon className={styles.toolIcon} />;
    case 'Grep':
      return <SearchIcon className={styles.toolIcon} />;
    case 'WebFetch':
    case 'WebSearch':
      return <GlobeIcon className={styles.toolIcon} />;
    default:
      return <ShieldAlertIcon className={styles.toolIcon} />;
  }
}

function getSummary(tool: string, input: Record<string, unknown>): string | null {
  if (tool === 'Bash' && typeof input.command === 'string') {
    return input.command;
  }
  if ((tool === 'Write' || tool === 'Edit') && typeof input.file_path === 'string') {
    return input.file_path;
  }
  if (tool === 'Read' && typeof input.file_path === 'string') {
    return input.file_path;
  }
  if (tool === 'Glob' && typeof input.pattern === 'string') {
    return input.pattern;
  }
  if (tool === 'Grep' && typeof input.pattern === 'string') {
    return input.pattern;
  }
  if ((tool === 'WebFetch' || tool === 'WebSearch') && typeof input.url === 'string') {
    return input.url;
  }
  return null;
}

interface PermissionDialogProps {
  request: PermissionRequest;
  onRespond: (requestId: string, behavior: PermissionBehavior) => void;
}

export const PermissionDialog: FC<PermissionDialogProps> = ({ request, onRespond }) => {
  const [showDetails, setShowDetails] = useState(false);
  const summary = getSummary(request.tool, request.input);
  const hasDetails = Object.keys(request.input).length > 0;

  return (
    <div
      className={styles.card}
      data-testid="permission-dialog"
      data-request-id={request.request_id}
    >
      <div className={styles.header}>
        <div className={styles.icon}>
          <ShieldAlertIcon className={styles.iconSvg} />
        </div>
        <span className={styles.title}>Permission Request</span>
        <span className={styles.toolBadge}>
          <ToolBadgeIcon tool={request.tool} />
          {request.tool}
        </span>
      </div>

      {summary && <div className={styles.summary}>{summary}</div>}

      {hasDetails && (
        <>
          <button
            type="button"
            className={styles.detailsToggle}
            onClick={() => setShowDetails(prev => !prev)}
          >
            <ChevronRightIcon className={styles.detailsChevron} data-open={showDetails} />
            Full details
          </button>
          {showDetails && (
            <div className={styles.detailsContent}>{JSON.stringify(request.input, null, 2)}</div>
          )}
        </>
      )}

      <div className={styles.actions}>
        <button
          type="button"
          className={styles.denyBtn}
          onClick={() => onRespond(request.request_id, 'deny')}
          data-testid="permission-deny"
        >
          <XIcon className={styles.btnIcon} />
          Deny
        </button>
        <button
          type="button"
          className={styles.allowForeverBtn}
          onClick={() => onRespond(request.request_id, 'allowForever')}
          data-testid="permission-allow-forever"
        >
          <ShieldCheckIcon className={styles.btnIcon} />
          Always Allow
        </button>
        <button
          type="button"
          className={styles.allowBtn}
          onClick={() => onRespond(request.request_id, 'allow')}
          data-testid="permission-allow"
        >
          <CheckIcon className={styles.btnIcon} />
          Allow
        </button>
      </div>
    </div>
  );
};

interface PermissionStackProps {
  permissions: readonly PermissionRequest[];
  onRespond: (requestId: string, behavior: PermissionBehavior) => void;
}

export const PermissionStack: FC<PermissionStackProps> = ({ permissions, onRespond }) => {
  if (permissions.length === 0) {
    return null;
  }

  return (
    <div className={styles.stack} data-testid="permission-stack">
      {permissions.map(p => (
        <PermissionDialog key={p.request_id} request={p} onRespond={onRespond} />
      ))}
    </div>
  );
};
