import { useState, Suspense } from 'react';
import type { IVolundrService } from '@/modules/volundr/ports';
import { SectionLayout } from '@/modules/volundr/components/SectionLayout';
import { useFeatureModules } from '@/modules/volundr/hooks/useFeatureModules';

interface SettingsPageProps {
  service: IVolundrService;
}

export function SettingsPage({ service }: SettingsPageProps) {
  const { sections, loading } = useFeatureModules('user', service);
  const [activeSection, setActiveSection] = useState('');

  const resolvedSection = activeSection || (sections.length > 0 ? sections[0].key : '');

  if (loading) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <SectionLayout
        title="Settings"
        sections={sections}
        activeSection={resolvedSection}
        onSectionChange={setActiveSection}
        service={service}
      />
    </Suspense>
  );
}
