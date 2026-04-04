import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import styles from './SectionLayout.module.css';

export interface SectionDefinition {
  key: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  component: React.ComponentType;
}

interface SectionLayoutProps {
  title: string;
  sections: SectionDefinition[];
  activeSection: string;
  onSectionChange: (key: string) => void;
}

export function SectionLayout({
  title,
  sections,
  activeSection,
  onSectionChange,
}: SectionLayoutProps) {
  const navigate = useNavigate();

  const active = sections.find(s => s.key === activeSection);
  const ActiveComponent = active?.component;

  return (
    <div className={styles.layout}>
      <aside className={styles.sidebar}>
        <button className={styles.backButton} onClick={() => navigate('/')} type="button">
          <ArrowLeft className={styles.backIcon} />
          Back
        </button>

        <h2 className={styles.title}>{title}</h2>

        <nav className={styles.nav}>
          {sections.map(section => {
            const Icon = section.icon;
            const isActive = section.key === activeSection;

            return (
              <button
                key={section.key}
                className={`${styles.navItem}${isActive ? ` ${styles.navItemActive}` : ''}`}
                onClick={() => onSectionChange(section.key)}
                type="button"
              >
                <Icon className={styles.navIcon} />
                {section.label}
              </button>
            );
          })}
        </nav>
      </aside>

      <main className={styles.content}>{ActiveComponent && <ActiveComponent />}</main>
    </div>
  );
}
