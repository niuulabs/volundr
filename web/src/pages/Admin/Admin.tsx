import { useState, useEffect, Suspense } from 'react';
import type { IVolundrService } from '@/ports';
import { SectionLayout } from '@/components/SectionLayout';
import { AdminGuard } from '@/components/AdminGuard';
import { useFeatureModules } from '@/hooks/useFeatureModules';

interface AdminPageProps {
  service: IVolundrService;
}

export function AdminPage({ service }: AdminPageProps) {
  const { sections, loading } = useFeatureModules('admin', service);
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
    <AdminGuard service={service}>
      <Suspense fallback={null}>
        <SectionLayout
          title="Admin"
          sections={sections}
          activeSection={activeSection}
          onSectionChange={setActiveSection}
          service={service}
        />
      </Suspense>
    </AdminGuard>
  );
}
