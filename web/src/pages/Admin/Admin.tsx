import { useState } from 'react';
import { Users, Building2, HardDrive } from 'lucide-react';
import type { IVolundrService } from '@/ports';
import { SectionLayout } from '@/components/SectionLayout';
import type { SectionDefinition } from '@/components/SectionLayout';
import { AdminGuard } from '@/components/AdminGuard';
import { UsersSection } from './sections/UsersSection';
import { TenantsSection } from './sections/TenantsSection';
import { StorageSection } from './sections/StorageSection';

const sections: SectionDefinition[] = [
  { key: 'users', label: 'Users', icon: Users, component: UsersSection },
  { key: 'tenants', label: 'Tenants', icon: Building2, component: TenantsSection },
  { key: 'storage', label: 'Storage', icon: HardDrive, component: StorageSection },
];

interface AdminPageProps {
  service: IVolundrService;
}

export function AdminPage({ service }: AdminPageProps) {
  const [activeSection, setActiveSection] = useState('users');

  return (
    <AdminGuard service={service}>
      <SectionLayout
        title="Admin"
        sections={sections}
        activeSection={activeSection}
        onSectionChange={setActiveSection}
        service={service}
      />
    </AdminGuard>
  );
}
