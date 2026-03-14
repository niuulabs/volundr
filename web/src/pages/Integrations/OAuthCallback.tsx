import { useEffect } from 'react';
import styles from './OAuthCallback.module.css';

export function OAuthCallback() {
  useEffect(() => {
    const timer = setTimeout(() => {
      window.close();
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h2 className={styles.title}>Connected</h2>
        <p className={styles.message}>This window will close automatically.</p>
      </div>
    </div>
  );
}
