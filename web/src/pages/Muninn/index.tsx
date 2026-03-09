import { useState } from 'react';
import {
  Brain,
  Star,
  Activity,
  Target,
  ThumbsUp,
  ThumbsDown,
  CheckCircle,
  RefreshCw,
} from 'lucide-react';
import { MetricCard, MemoryCard, SearchInput, MythologySection } from '@/components';
import { useMemories } from '@/hooks';
import styles from './MuninnPage.module.css';

export function MuninnPage() {
  const { memories, stats, loading, searchMemories } = useMemories();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<typeof memories | null>(null);

  const handleSearch = async (query: string) => {
    setSearchQuery(query);
    if (query) {
      const results = await searchMemories(query);
      setSearchResults(results);
    } else {
      setSearchResults(null);
    }
  };

  const displayedMemories = searchResults ?? memories;

  const totalMemories = stats?.totalMemories ?? 0;
  const preferences = stats?.preferences ?? 0;
  const patterns = stats?.patterns ?? 0;
  const outcomes = stats?.outcomes ?? 0;

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.loading}>Loading...</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.titleSection}>
          <div className={styles.titleRow}>
            <div className={styles.iconContainer}>
              <Brain className={styles.icon} />
            </div>
            <div>
              <h1 className={styles.title}>Muninn</h1>
              <p className={styles.subtitle}>Long-term memory — patterns, preferences, outcomes</p>
            </div>
          </div>
        </div>
        <SearchInput value={searchQuery} onChange={handleSearch} placeholder="Search memories..." />
      </div>

      <MythologySection
        storageKey="muninn"
        title="The Raven of Memory"
        icon={Brain}
        accentColor="purple"
        description="Muninn ('Memory') was one of Odin's two ravens, flying across the worlds each day and returning to whisper what they learned. In ODIN, Muninn is the long-term memory system—storing patterns recognized over time, user preferences, and outcomes of past decisions. This accumulated wisdom shapes ODIN's confidence and behavior."
        footerItems={[
          'Storage: Qdrant (vectors) + PostgreSQL (structured)',
          'Updates: Continuous learning from outcomes',
        ]}
      />

      <div className={styles.metricsRow}>
        <MetricCard label="Total Memories" value={totalMemories} icon={Brain} iconColor="purple" />
        <MetricCard label="Preferences" value={preferences} icon={Star} iconColor="amber" />
        <MetricCard label="Patterns" value={patterns} icon={Activity} iconColor="cyan" />
        <MetricCard label="Outcomes" value={outcomes} icon={Target} iconColor="emerald" />
      </div>

      <div className={styles.content}>
        <div className={styles.memoriesSection}>
          <h2 className={styles.sectionTitle}>Stored Memories</h2>
          <div className={styles.memoriesList}>
            {displayedMemories.map(memory => (
              <MemoryCard key={memory.id} memory={memory} />
            ))}
          </div>
        </div>

        <div className={styles.learningSection}>
          <h2 className={styles.sectionTitle}>Feedback & Learning</h2>
          <div className={styles.learningCard}>
            <h3 className={styles.learningTitle}>How ODIN Learns</h3>
            <div className={styles.learningList}>
              <div className={styles.learningItem}>
                <ThumbsUp className={styles.learningIconGreen} />
                <span>
                  <strong>Explicit feedback:</strong> "ODIN, that was helpful" reinforces behavior
                </span>
              </div>
              <div className={styles.learningItem}>
                <ThumbsDown className={styles.learningIconRed} />
                <span>
                  <strong>Corrections:</strong> "ODIN, that was wrong" adjusts confidence
                </span>
              </div>
              <div className={styles.learningItem}>
                <CheckCircle className={styles.learningIconCyan} />
                <span>
                  <strong>Implicit signals:</strong> PR merged = good work, rollback = confidence
                  penalty
                </span>
              </div>
              <div className={styles.learningItem}>
                <RefreshCw className={styles.learningIconAmber} />
                <span>
                  <strong>Calibration:</strong> Merge thresholds adjust based on outcomes
                </span>
              </div>
            </div>
          </div>

          <div className={styles.summaryCard}>
            <h3 className={styles.learningTitle}>This Month's Summary</h3>
            <div className={styles.summaryStats}>
              <div className={styles.summaryStat}>
                <span className={styles.summaryValue}>47</span>
                <span className={styles.summaryLabel}>Autonomous tasks</span>
              </div>
              <div className={styles.summaryStat}>
                <span className={styles.summaryValueGreen}>44</span>
                <span className={styles.summaryLabel}>Successful</span>
              </div>
              <div className={styles.summaryStat}>
                <span className={styles.summaryValueAmber}>2</span>
                <span className={styles.summaryLabel}>Rolled back</span>
              </div>
            </div>
            <p className={styles.summaryText}>
              Confidence calibration is improving. 1 required manual correction.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
