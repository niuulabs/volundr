import { useState, useCallback } from 'react';
import {
  ChevronDown,
  ChevronRight,
  FolderGit2,
  Cpu,
  Terminal as TerminalIcon,
  Server,
  Zap,
  Settings2,
} from 'lucide-react';
import { cn } from '@/utils';
import type { VolundrTemplate, VolundrRepo, VolundrModel, RepoProvider } from '@/models';
import styles from './TemplateBrowser.module.css';

export interface TemplateBrowserProps {
  templates: VolundrTemplate[];
  repos: VolundrRepo[];
  models: Record<string, VolundrModel>;
  onLaunch: (config: {
    name: string;
    repo: string;
    branch: string;
    model: string;
    templateName: string;
  }) => Promise<void>;
  isLaunching: boolean;
}

const PROVIDER_LABELS: Record<RepoProvider, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  bitbucket: 'Bitbucket',
};

export function TemplateBrowser({
  templates,
  repos,
  models,
  onLaunch,
  isLaunching,
}: TemplateBrowserProps) {
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);
  const [sessionName, setSessionName] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [selectedBranch, setSelectedBranch] = useState('');
  const [selectedModel, setSelectedModel] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const resetForm = useCallback(() => {
    setSessionName('');
    setSelectedRepo('');
    setSelectedBranch('');
    setSelectedModel('');
    setShowAdvanced(false);
  }, []);

  const handleCardClick = useCallback(
    (template: VolundrTemplate) => {
      if (expandedTemplate === template.name) {
        setExpandedTemplate(null);
        resetForm();
        return;
      }

      setExpandedTemplate(template.name);
      setShowAdvanced(false);

      // Auto-fill from template
      if (template.model) {
        setSelectedModel(template.model);
      } else {
        setSelectedModel('');
      }

      if (template.repos.length > 0) {
        const templateRepo = template.repos[0];
        const matchedRepo = repos.find(r => r.cloneUrl === templateRepo.repo);
        if (matchedRepo) {
          setSelectedRepo(matchedRepo.cloneUrl);
          setSelectedBranch(templateRepo.branch ?? matchedRepo.defaultBranch);
        } else {
          setSelectedRepo('');
          setSelectedBranch('');
        }
      } else {
        setSelectedRepo('');
        setSelectedBranch('');
      }

      setSessionName('');
    },
    [expandedTemplate, repos, resetForm]
  );

  const handleCancel = useCallback(() => {
    setExpandedTemplate(null);
    resetForm();
  }, [resetForm]);

  const handleLaunch = useCallback(async () => {
    if (!expandedTemplate || !sessionName.trim() || !selectedRepo || !selectedModel) {
      return;
    }

    const template = templates.find(t => t.name === expandedTemplate);
    if (!template) {
      return;
    }

    await onLaunch({
      name: sessionName.trim(),
      repo: selectedRepo,
      branch: selectedBranch,
      model: selectedModel,
      templateName: template.name,
    });

    setExpandedTemplate(null);
    resetForm();
  }, [
    expandedTemplate,
    sessionName,
    selectedRepo,
    selectedBranch,
    selectedModel,
    templates,
    onLaunch,
    resetForm,
  ]);

  const currentRepo = repos.find(r => r.cloneUrl === selectedRepo);
  const branches = currentRepo?.branches ?? [];

  // Group repos by provider for the select
  const reposByProvider = repos.reduce<Record<RepoProvider, VolundrRepo[]>>(
    (acc, repo) => {
      acc[repo.provider] = acc[repo.provider] || [];
      acc[repo.provider].push(repo);
      return acc;
    },
    {} as Record<RepoProvider, VolundrRepo[]>
  );

  const expandedTemplateData = expandedTemplate
    ? templates.find(t => t.name === expandedTemplate)
    : null;

  const canLaunch = sessionName.trim() && selectedRepo && selectedModel && !isLaunching;

  return (
    <div className={styles.grid}>
      {templates.map(template => {
        const isExpanded = expandedTemplate === template.name;

        return (
          <div
            key={template.name}
            className={cn(styles.card, isExpanded && styles.cardExpanded)}
            onClick={!isExpanded ? () => handleCardClick(template) : undefined}
            role={!isExpanded ? 'button' : undefined}
            tabIndex={!isExpanded ? 0 : undefined}
            onKeyDown={
              !isExpanded
                ? (e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleCardClick(template);
                    }
                  }
                : undefined
            }
          >
            {/* Card Header */}
            <div className={styles.cardHeader}>
              <span className={styles.cardName}>{template.name}</span>
              {isExpanded ? (
                <ChevronDown className={styles.chevronIcon} />
              ) : (
                <ChevronRight className={styles.chevronIcon} />
              )}
            </div>

            {/* Description */}
            <p
              className={cn(styles.cardDescription, !isExpanded && styles.cardDescriptionTruncated)}
            >
              {template.description}
            </p>

            {/* Badges */}
            <div className={styles.badges}>
              {template.repos.length > 0 && (
                <span className={cn(styles.badge, styles.badgeRepo)}>
                  <FolderGit2 className={styles.badgeIcon} />
                  {template.repos.length} {template.repos.length === 1 ? 'repo' : 'repos'}
                </span>
              )}
              {template.model && (
                <span className={cn(styles.badge, styles.badgeModel)}>
                  <Cpu className={styles.badgeIcon} />
                  {template.model}
                </span>
              )}
            </div>

            {/* Expanded Content */}
            {isExpanded && (
              <div className={styles.expandedContent}>
                {/* Session Name */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    <TerminalIcon className={styles.formLabelIcon} />
                    Session Name
                  </label>
                  <input
                    className={styles.formInput}
                    type="text"
                    placeholder="e.g. feature-auth-refactor"
                    value={sessionName}
                    onChange={e => setSessionName(e.target.value)}
                  />
                </div>

                {/* Repository */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    <FolderGit2 className={styles.formLabelIcon} />
                    Repository
                  </label>
                  <div className={styles.repoSelectWrapper}>
                    <FolderGit2 className={styles.repoSelectIcon} />
                    <select
                      className={cn(styles.formSelect, styles.repoSelect)}
                      value={selectedRepo}
                      onChange={e => {
                        setSelectedRepo(e.target.value);
                        const repo = repos.find(r => r.cloneUrl === e.target.value);
                        setSelectedBranch(repo?.defaultBranch ?? '');
                      }}
                    >
                      <option value="">Select repository...</option>
                      {Object.entries(reposByProvider).map(([provider, providerRepos]) => (
                        <optgroup key={provider} label={PROVIDER_LABELS[provider as RepoProvider]}>
                          {providerRepos.map(repo => (
                            <option key={repo.cloneUrl} value={repo.cloneUrl}>
                              {repo.org}/{repo.name}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Branch */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>Branch</label>
                  <select
                    className={styles.formSelect}
                    value={selectedBranch}
                    onChange={e => setSelectedBranch(e.target.value)}
                    disabled={!selectedRepo}
                  >
                    <option value="">Select branch...</option>
                    {branches.map(branch => (
                      <option key={branch} value={branch}>
                        {branch}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Model */}
                <div className={styles.formGroup}>
                  <label className={styles.formLabel}>
                    <Cpu className={styles.formLabelIcon} />
                    Model
                  </label>
                  <select
                    className={styles.formSelect}
                    value={selectedModel}
                    onChange={e => setSelectedModel(e.target.value)}
                  >
                    <option value="">Select model...</option>
                    {Object.entries(models).map(([key, model]) => (
                      <option key={key} value={key}>
                        {model.provider === 'local' ? '⚡ ' : '☁ '}
                        {model.name} ({model.tier})
                      </option>
                    ))}
                  </select>
                </div>

                {/* Advanced Section */}
                <div className={styles.advancedSection}>
                  <button
                    className={styles.advancedToggle}
                    onClick={() => setShowAdvanced(prev => !prev)}
                    type="button"
                  >
                    {showAdvanced ? (
                      <ChevronDown className={styles.advancedChevron} />
                    ) : (
                      <ChevronRight className={styles.advancedChevron} />
                    )}
                    <Settings2 className={styles.advancedIcon} />
                    Advanced
                  </button>

                  {showAdvanced && (
                    <div className={styles.advancedContent}>
                      {/* Setup Scripts */}
                      {expandedTemplateData && expandedTemplateData.setupScripts.length > 0 && (
                        <div className={styles.advancedGroup}>
                          <span className={styles.advancedLabel}>Setup Scripts</span>
                          <div className={styles.advancedList}>
                            {expandedTemplateData.setupScripts.map((script, idx) => (
                              <span key={idx} className={styles.advancedValue}>
                                <TerminalIcon className={styles.advancedItemIcon} />
                                {script}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* MCP Servers */}
                      {expandedTemplateData && expandedTemplateData.mcpServers.length > 0 && (
                        <div className={styles.advancedGroup}>
                          <span className={styles.advancedLabel}>MCP Servers</span>
                          <div className={styles.advancedList}>
                            {expandedTemplateData.mcpServers.map((server, idx) => (
                              <span key={idx} className={styles.advancedValue}>
                                <Server className={styles.advancedItemIcon} />
                                {server.name}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Resource Config */}
                      {expandedTemplateData &&
                        Object.keys(expandedTemplateData.resourceConfig).length > 0 && (
                          <div className={styles.advancedGroup}>
                            <span className={styles.advancedLabel}>Resources</span>
                            <div className={styles.advancedKeyValues}>
                              {Object.entries(expandedTemplateData.resourceConfig).map(
                                ([key, val]) => (
                                  <div key={key} className={styles.advancedItem}>
                                    <span className={styles.advancedItemKey}>{key}</span>
                                    <span className={styles.advancedItemValue}>{String(val)}</span>
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )}

                      {/* Environment Secrets (keys only) */}
                      {expandedTemplateData && expandedTemplateData.envSecretRefs.length > 0 && (
                        <div className={styles.advancedGroup}>
                          <span className={styles.advancedLabel}>Environment Secrets</span>
                          <div className={styles.advancedList}>
                            {expandedTemplateData.envSecretRefs.map(secretKey => (
                              <span key={secretKey} className={styles.advancedValue}>
                                <Zap className={styles.advancedItemIcon} />
                                {secretKey}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Empty advanced state */}
                      {(!expandedTemplateData ||
                        (expandedTemplateData.setupScripts.length === 0 &&
                          expandedTemplateData.mcpServers.length === 0 &&
                          Object.keys(expandedTemplateData.resourceConfig).length === 0 &&
                          expandedTemplateData.envSecretRefs.length === 0)) && (
                        <p className={styles.advancedEmpty}>No advanced configuration.</p>
                      )}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className={styles.actions}>
                  <button className={styles.cancelButton} onClick={handleCancel} type="button">
                    Cancel
                  </button>
                  <button
                    className={styles.launchButton}
                    onClick={handleLaunch}
                    disabled={!canLaunch}
                    type="button"
                  >
                    {isLaunching ? 'Creating...' : 'Create Session'}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
