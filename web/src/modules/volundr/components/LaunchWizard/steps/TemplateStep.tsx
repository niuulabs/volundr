import { useState, useMemo } from 'react';
import { FolderGit2, Cpu, Star, Plus } from 'lucide-react';
import { cn } from '@/utils';
import type { VolundrTemplate } from '@/modules/volundr/models';
import { SearchInput } from '@/modules/shared';
import styles from './TemplateStep.module.css';

export interface TemplateStepProps {
  templates: VolundrTemplate[];
  onSelect: (template: VolundrTemplate | null) => void;
}

const BLANK_TEMPLATE: VolundrTemplate = {
  name: '',
  description: '',
  isDefault: false,
  repos: [],
  setupScripts: [],
  workspaceLayout: {},
  cliTool: 'claude',
  workloadType: 'coding',
  model: null,
  systemPrompt: null,
  resourceConfig: {},
  mcpServers: [],
  envVars: {},
  envSecretRefs: [],
  workloadConfig: {},
  terminalSidecar: { enabled: false, allowedCommands: [] },
  skills: [],
  rules: [],
};

export function TemplateStep({ templates, onSelect }: TemplateStepProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    if (!search.trim()) {
      return templates;
    }
    const q = search.toLowerCase();
    return templates.filter(
      t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.workloadType.toLowerCase().includes(q)
    );
  }, [templates, search]);

  return (
    <div className={styles.container}>
      <div className={styles.searchBar}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search templates..." />
      </div>

      <div className={styles.grid}>
        {/* Blank / Custom card */}
        <button
          className={cn(styles.card, styles.cardBlank)}
          onClick={() => onSelect(null)}
          type="button"
          aria-label="Start from scratch"
        >
          <div className={styles.cardIcon}>
            <Plus />
          </div>
          <span className={styles.cardName}>Blank</span>
          <p className={styles.cardDescription}>Start from scratch with an empty configuration</p>
        </button>

        {filtered.map(template => (
          <button
            key={template.name}
            className={styles.card}
            onClick={() => onSelect(template)}
            type="button"
            aria-label={`Select template ${template.name}`}
          >
            {template.isDefault && (
              <Star className={styles.defaultStar} aria-label="Default template" />
            )}
            <span className={styles.cardName}>{template.name}</span>
            <p className={styles.cardDescription}>{template.description}</p>

            <div className={styles.badges}>
              {template.workloadType && (
                <span className={styles.badge}>{template.workloadType}</span>
              )}
              {template.repos.length > 0 && (
                <span className={styles.badge}>
                  <FolderGit2 className={styles.badgeIcon} />
                  {template.repos.length} {template.repos.length === 1 ? 'repo' : 'repos'}
                </span>
              )}
              {template.model && (
                <span className={styles.badge}>
                  <Cpu className={styles.badgeIcon} />
                  {template.model}
                </span>
              )}
            </div>

            {Object.keys(template.resourceConfig).length > 0 && (
              <div className={styles.resourceSummary}>
                {Object.entries(template.resourceConfig).map(([key, val]) => (
                  <span key={key} className={styles.resourceItem}>
                    {key}: {String(val)}
                  </span>
                ))}
              </div>
            )}
          </button>
        ))}
      </div>

      {filtered.length === 0 && search.trim() && (
        <p className={styles.emptyMessage}>No templates match &quot;{search}&quot;</p>
      )}
    </div>
  );
}

export { BLANK_TEMPLATE };
