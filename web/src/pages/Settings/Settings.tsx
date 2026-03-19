import { useState, useEffect, Suspense } from 'react';
import type { IVolundrService } from '@/ports';
import { SectionLayout } from '@/components/SectionLayout';
import { useFeatureModules } from '@/hooks/useFeatureModules';

interface SettingsPageProps {
  service: IVolundrService;
}

export function SettingsPage({ service }: SettingsPageProps) {
  const { sections, loading } = useFeatureModules('user', service);
  const [activeSection, setActiveSection] = useState('');

  useEffect(() => {
    if (sections.length > 0 && !activeSection) {
      setActiveSection(sections[0].key);
    }
  }, [sections, activeSection]);

  if (loading) {
    return null;
  }

  return (
    <Suspense fallback={null}>
      <SectionLayout
        title="Settings"
        sections={sections}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        service={service}
      />
    </Suspense>
  );
}
