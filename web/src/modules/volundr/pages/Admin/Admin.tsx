import { useState, Suspense } from 'react';
import type { IVolundrService } from '@/modules/volundr/ports';
import { SectionLayout } from '@/modules/volundr/components/SectionLayout';
import { AdminGuard } from '@/modules/volundr/components/AdminGuard';
import { useFeatureModules } from '@/modules/volundr/hooks/useFeatureModules';

interface AdminPageProps {
  service: IVolundrService;
}

export function AdminPage({ service }: AdminPageProps) {
  const { sections, loading } = useFeatureModules('admin', service);
  const [activeSection, setActiveSection] = useState('');

  const resolvedSection = activeSection || (sections.length > 0 ? sections[0].key : '');

  if (loading) {
    return null;
  }

  return (
    <AdminGuard service={service}>
      <Suspense fallback={null}>
        <SectionLayout
          title="Admin"
          sections={sections}
          activeSection={resolvedSection}
          onSectionChange={setActiveSection}
          service={service}
        />
      </Suspense>
    </AdminGuard>
  );
}
