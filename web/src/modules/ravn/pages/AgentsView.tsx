import styles from './AgentsView.module.css';

export function AgentsView() {
  return (
    <div className={styles.container}>
      <h2 className={styles.heading}>Agent Configuration</h2>
      <p className={styles.description}>
        Configure Ravn agent settings, platform tool endpoints, and channel
        delivery options.
      </p>
      <section className={styles.section}>
        <h3 className={styles.sectionHeading}>Platform Tools</h3>
        <ul className={styles.toolList}>
          <li className={styles.toolItem}>
            <span className={styles.toolName}>volundr_session</span>
            <span className={styles.toolDesc}>
              Create, start, stop, and list Volundr coding sessions
            </span>
          </li>
          <li className={styles.toolItem}>
            <span className={styles.toolName}>volundr_git</span>
            <span className={styles.toolDesc}>
              Git operations — branch, pull request, CI status via Volundr API
            </span>
          </li>
          <li className={styles.toolItem}>
            <span className={styles.toolName}>tyr_saga</span>
            <span className={styles.toolDesc}>
              Decompose specs, dispatch raids, check saga status via Tyr API
            </span>
          </li>
          <li className={styles.toolItem}>
            <span className={styles.toolName}>tracker_issue</span>
            <span className={styles.toolDesc}>
              Create and update Linear / Jira issues via Tyr tracker adapters
            </span>
          </li>
        </ul>
      </section>
    </div>
  );
}
