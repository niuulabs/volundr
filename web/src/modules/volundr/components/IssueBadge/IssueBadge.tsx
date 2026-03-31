import styles from './IssueBadge.module.css';

interface IssueBadgeProps {
  identifier: string;
  title: string;
  url?: string;
}

export function IssueBadge({ identifier, title, url }: IssueBadgeProps) {
  const content = (
    <>
      <span className={styles.identifier}>{identifier}</span>
      <span className={styles.title}>{title}</span>
    </>
  );

  if (url) {
    return (
      <a
        className={styles.badge}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={`${identifier}: ${title}`}
      >
        {content}
      </a>
    );
  }

  return (
    <span className={styles.badge} title={`${identifier}: ${title}`}>
      {content}
    </span>
  );
}
