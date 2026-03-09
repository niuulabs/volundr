import { useState } from 'react';
import { KeyRound, Link2, Palette, HardDrive } from 'lucide-react';
import type { IVolundrService } from '@/ports';
import { SectionLayout } from '@/components/SectionLayout';
import type { SectionDefinition } from '@/components/SectionLayout';
import { CredentialsSection } from './sections/CredentialsSection';
import { IntegrationsSection } from './sections/IntegrationsSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { WorkspacesSection } from './sections/WorkspacesSection';

const AppearanceWrapper = () => <AppearanceSection />;

const sections: SectionDefinition[] = [
  { key: 'credentials', label: 'Credentials', icon: KeyRound, component: CredentialsSection },
  { key: 'workspaces', label: 'Workspaces', icon: HardDrive, component: WorkspacesSection },
  { key: 'integrations', label: 'Integrations', icon: Link2, component: IntegrationsSection },
  {
    key: 'appearance',
    label: 'Appearance',
    icon: Palette,
    component: AppearanceWrapper as SectionDefinition['component'],
  },
];

interface SettingsPageProps {
  service: IVolundrService;
}

export function SettingsPage({ service }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState('credentials');

  return (
    <SectionLayout
      title="Settings"
      sections={sections}
      activeSection={activeSection}
      onSectionChange={setActiveSection}
      service={service}
    />
  );
}
