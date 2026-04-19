import { useState } from 'react';
import type { TypeRegistry } from '../domain/registry';
import styles from './JsonTab.module.css';

export interface JsonTabProps {
  registry: TypeRegistry;
}

export function JsonTab({ registry }: JsonTabProps) {
  const [copied, setCopied] = useState(false);
  const json = JSON.stringify(registry, null, 2);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(json);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className={styles.container}>
      <div className={styles.toolbar}>
        <button className={styles.copyBtn} onClick={handleCopy} aria-label="Copy JSON to clipboard">
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      <pre className={styles.code} aria-label="Registry JSON">
        {json}
      </pre>
    </div>
  );
}
