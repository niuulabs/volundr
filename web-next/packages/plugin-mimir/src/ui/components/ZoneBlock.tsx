import { useRef } from 'react';
import { StateDot } from '@niuulabs/ui';
import { MountChip } from './MountChip';
import { ZoneBodyReadonly, zoneToEditableText } from './ZoneRenderers';
import type { ZoneEditState } from '../../domain/zone-edit';
import type { Zone } from '../../domain/page';
import type { PageMeta } from '../../domain/page';

const ZONE_LABELS: Record<string, string> = {
  'key-facts': 'Key facts',
  relationships: 'Relationships',
  assessment: 'Assessment',
  timeline: 'Timeline',
};

interface ZoneBlockProps {
  zone: Zone;
  pagePath: string;
  pageMounts: string[];
  allPages: PageMeta[];
  onNavigate: (path: string) => void;
  editState: ZoneEditState;
  onEdit: (zone: Zone) => void;
  onSave: (text: string) => void;
  onCancel: () => void;
}

function EditZoneBody({
  zone,
  textareaRef,
}: {
  zone: Zone;
  textareaRef: React.RefObject<HTMLTextAreaElement>;
}) {
  const text = zoneToEditableText(zone);
  return (
    <div className="mm-zone-edit-footer">
      <textarea
        ref={textareaRef}
        className="mm-zone-edit-area"
        defaultValue={text}
        aria-label="zone edit area"
      />
      <p className="mm-zone-edit-note">
        Editing {zone.kind} zone — changes will be written to the destination mount.
      </p>
    </div>
  );
}

export function ZoneBlock({
  zone,
  pagePath,
  pageMounts,
  allPages,
  onNavigate,
  editState,
  onEdit,
  onSave,
  onCancel,
}: ZoneBlockProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isEditingThis =
    editState.status === 'editing' &&
    editState.path === pagePath &&
    editState.zoneKind === zone.kind;
  const isSavingThis = editState.status === 'saving' && editState.path === pagePath;
  const isSaved = editState.status === 'saved' && editState.path === pagePath;
  const errorMessage =
    editState.status === 'error' && editState.path === pagePath ? editState.message : null;

  const canEdit = editState.status === 'idle';
  const label = ZONE_LABELS[zone.kind] ?? zone.kind;

  return (
    <div className={`mm-zone${isEditingThis ? ' mm-zone--editing' : ''}`}>
      <div className="mm-zone-head">
        <span className="mm-zone-title">{label}</span>
        <div className="mm-zone-saving-row">
          {isSavingThis && <StateDot state="processing" pulse />}
          {canEdit && !isEditingThis && (
            <button
              type="button"
              className="mm-btn"
              onClick={() => onEdit(zone)}
              aria-label={`edit ${zone.kind} zone`}
            >
              ✎ edit
            </button>
          )}
          {isEditingThis && (
            <>
              <button
                type="button"
                className="mm-btn mm-btn--primary"
                onClick={() => onSave(textareaRef.current?.value ?? '')}
                aria-label={`save ${zone.kind} zone`}
              >
                save
              </button>
              <button type="button" className="mm-btn" onClick={onCancel} aria-label="cancel edit">
                cancel
              </button>
            </>
          )}
        </div>
      </div>

      <div className="mm-zone-body">
        {isSaved && (
          <div className="mm-save-banner">
            ✓ saved →{' '}
            {pageMounts.map((m) => (
              <MountChip key={m} name={m} />
            ))}
          </div>
        )}
        {errorMessage && <div className="mm-error-banner">{errorMessage}</div>}

        {isEditingThis ? (
          <EditZoneBody zone={editState.draft} textareaRef={textareaRef} />
        ) : (
          <ZoneBodyReadonly zone={zone} allPages={allPages} onNavigate={onNavigate} />
        )}
      </div>
    </div>
  );
}
