import { useState, Suspense } from 'react';
import { volundrService } from '@/modules/volundr/adapters';
import { SectionLayout } from '@/modules/volundr/components/SectionLayout';
import { AdminGuard } from '@/modules/volundr/components/AdminGuard';
import { useFeatureModules } from '@/modules/volundr/hooks/useFeatureModules';

export function AdminPage() {
  const { sections, loading } = useFeatureModules('admin', volundrService);
  const [activeSection, setActiveSection] = useState('');

  const resolvedSection = activeSection || (sections.length > 0 ? sections[0].key : '');

  if (loading) {
    return null;
  }

  return (
    <AdminGuard>
      <Suspense fallback={null}>
        <SectionLayout
          title="Admin"
          sections={sections}
          activeSection={resolvedSection}
          onSectionChange={setActiveSection}
        />
      </Suspense>
    </AdminGuard>
  );
}
