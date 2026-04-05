import { useState, Suspense } from 'react';
import { featureCatalogService } from '@/modules/shared/adapters/feature-catalog.adapter';
import { SectionLayout } from '@/modules/volundr/components/SectionLayout';
import { useFeatureModules } from '@/modules/volundr/hooks/useFeatureModules';

export function SettingsPage() {
  const { sections, loading } = useFeatureModules('user', featureCatalogService);
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
      />
    </Suspense>
  );
}
