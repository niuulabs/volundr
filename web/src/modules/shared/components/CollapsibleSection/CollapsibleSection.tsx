import type { ReactNode, ElementType } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { cn } from '@/modules/shared/utils/classnames';
import styles from './CollapsibleSection.module.css';

export type AccentColor =
  | 'amber'
  | 'cyan'
  | 'emerald'
  | 'purple'
  | 'red'
  | 'indigo'
  | 'orange'
  | 'yellow'
  | 'blue';

export interface CollapsibleSectionProps {
  /** Unique storage key for persisting collapsed state */
  storageKey: string;
  /** The title of the section */
  title: string;
  /** Main descriptive text */
  description: string;
  /** Icon component to display */
  icon: ElementType;
  /** Accent color theme */
  accentColor: AccentColor;
  /** Optional footer items (displayed as bullet-separated list) */
  footerItems?: string[];
  /** Additional content to render inside the expanded section */
  children?: ReactNode;
  /** Whether the section starts collapsed (default: false) */
  defaultCollapsed?: boolean;
}

export function CollapsibleSection({
  storageKey,
  title,
  description,
  icon: Icon,
  accentColor,
  footerItems,
  children,
  defaultCollapsed = false,
}: CollapsibleSectionProps) {
  const [isCollapsed, setIsCollapsed] = useLocalStorage(
    `collapsible-section-${storageKey}`,
    defaultCollapsed
  );

  const toggleCollapsed = () => {
    setIsCollapsed(!isCollapsed);
  };

  return (
    <div className={cn(styles.container, styles[accentColor])} data-collapsed={isCollapsed}>
      <button type="button" className={styles.header} onClick={toggleCollapsed}>
        <div className={styles.headerLeft}>
          <div className={styles.iconBox}>
            <Icon className={styles.icon} />
          </div>
          <h3 className={styles.title}>{title}</h3>
        </div>
        <div className={styles.chevron}>
          {isCollapsed ? (
            <ChevronRight className={styles.chevronIcon} />
          ) : (
            <ChevronDown className={styles.chevronIcon} />
          )}
        </div>
      </button>

      {!isCollapsed && (
        <div className={styles.content}>
          <p className={styles.description}>{description}</p>
          {footerItems && footerItems.length > 0 && (
            <div className={styles.footer}>
              {footerItems.map((item, index) => (
                <span key={index}>{item}</span>
              ))}
            </div>
          )}
          {children}
        </div>
      )}
    </div>
  );
}
