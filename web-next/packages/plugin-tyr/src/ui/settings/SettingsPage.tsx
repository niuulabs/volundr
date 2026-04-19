import { useRouter } from '@tanstack/react-router';
import { PersonasSection } from './PersonasSection';
import { FlockConfigSection } from './FlockConfigSection';
import { DispatchDefaultsSection } from './DispatchDefaultsSection';
import { NotificationsSection } from './NotificationsSection';
import { AuditLogSection } from './AuditLogSection';

interface SettingsPageProps {
  section: 'personas' | 'flock' | 'dispatch' | 'notifications' | 'audit';
}

export function SettingsPage({ section }: SettingsPageProps) {
  return (
    <div className="niuu-p-6 niuu-max-w-[900px]">
      {section === 'personas' && <PersonasSection />}
      {section === 'flock' && <FlockConfigSection />}
      {section === 'dispatch' && <DispatchDefaultsSection />}
      {section === 'notifications' && <NotificationsSection />}
      {section === 'audit' && <AuditLogSection />}
    </div>
  );
}

export function SettingsIndexPage() {
  const router = useRouter();

  return (
    <div className="niuu-p-6 niuu-max-w-[720px]">
      <h2 className="niuu-text-lg niuu-font-semibold niuu-text-text-primary niuu-mb-2">
        Tyr Settings
      </h2>
      <p className="niuu-text-sm niuu-text-text-secondary niuu-mb-6">
        Configure your Tyr deployment. Select a section from the left to get started.
      </p>

      <div className="niuu-grid niuu-grid-cols-2 niuu-gap-3" role="list">
        {[
          {
            id: 'personas',
            label: 'Personas',
            description: 'Browse and inspect Ravn persona configurations',
          },
          {
            id: 'flock',
            label: 'Flock Config',
            description: 'Global defaults for new Sagas and Raids',
          },
          {
            id: 'dispatch',
            label: 'Dispatch Defaults',
            description: 'Confidence thresholds, batch sizes, and retry policy',
          },
          {
            id: 'notifications',
            label: 'Notifications',
            description: 'Event triggers and delivery channels',
          },
          {
            id: 'audit',
            label: 'Audit Log',
            description: 'Immutable record of settings changes and dispatch events',
          },
        ].map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => void router.navigate({ to: `/tyr/settings/${item.id}` as any })}
            className="niuu-block niuu-w-full niuu-text-left niuu-p-4 niuu-border niuu-border-border niuu-rounded-md hover:niuu-bg-bg-secondary niuu-transition-colors"
            role="listitem"
          >
            <p className="niuu-text-sm niuu-font-medium niuu-text-text-primary niuu-mb-1">
              {item.label}
            </p>
            <p className="niuu-text-xs niuu-text-text-secondary">{item.description}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
