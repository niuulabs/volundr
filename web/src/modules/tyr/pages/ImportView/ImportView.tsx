import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { LoadingIndicator } from '@/modules/shared';
import { useTrackerBrowser } from '../../hooks';
import { ProjectCard } from '../../components/ProjectCard';
import { MilestoneRow } from '../../components/MilestoneRow';
import { RepoSelector } from '../../components/RepoSelector';
import styles from './ImportView.module.css';

export function ImportView() {
  const {
    projects,
    selectedProject,
    milestones,
    issues,
    repos,
    selectedRepos,
    loading,
    error,
    selectProject,
    clearProject,
    toggleRepo,
    importProject,
  } = useTrackerBrowser();

  const navigate = useNavigate();
  const [expandedMilestones, setExpandedMilestones] = useState<Set<string>>(new Set());
  const [importing, setImporting] = useState(false);

  const toggleMilestone = (milestoneId: string) => {
    setExpandedMilestones(prev => {
      const next = new Set(prev);
      if (next.has(milestoneId)) {
        next.delete(milestoneId);
      } else {
        next.add(milestoneId);
      }
      return next;
    });
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      await importProject();
      navigate('/tyr/sagas');
    } catch {
      // error is set by the hook
    } finally {
      setImporting(false);
    }
  };

  if (loading && !selectedProject && projects.length === 0) {
    return <LoadingIndicator messages={['Loading projects...']} />;
  }

  if (error && !selectedProject && projects.length === 0) {
    return <div className={styles.error}>{error}</div>;
  }

  if (!selectedProject) {
    return (
      <div className={styles.container}>
        <h2 className={styles.heading}>Import from Tracker</h2>
        <p className={styles.subtitle}>
          Select a project to browse its milestones and issues, then import as a saga.
        </p>
        <div className={styles.projectGrid}>
          {projects.map(project => (
            <ProjectCard
              key={project.id}
              project={project}
              onClick={() => selectProject(project.id)}
            />
          ))}
        </div>
        {projects.length === 0 && !loading && (
          <div className={styles.empty}>No projects found in tracker</div>
        )}
      </div>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.projectHeader}>
        <button type="button" className={styles.backButton} onClick={clearProject}>
          <ArrowLeft className={styles.backIcon} />
          Back
        </button>
        <h2 className={styles.heading}>{selectedProject.name}</h2>
      </div>
      {selectedProject.description && (
        <p className={styles.projectDescription}>{selectedProject.description}</p>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {loading && <LoadingIndicator messages={['Loading project details...']} />}

      {!loading && (
        <>
          <div className={styles.milestoneList}>
            {milestones.map(milestone => {
              const milestoneIssues = issues.filter(i => i.milestone_id === milestone.id);
              return (
                <MilestoneRow
                  key={milestone.id}
                  milestone={milestone}
                  issues={milestoneIssues}
                  expanded={expandedMilestones.has(milestone.id)}
                  onToggle={() => toggleMilestone(milestone.id)}
                />
              );
            })}

            {/* Issues without a milestone */}
            {issues.filter(i => i.milestone_id === null).length > 0 && (
              <MilestoneRow
                milestone={{
                  id: '__no_milestone__',
                  project_id: selectedProject.id,
                  name: 'No Milestone',
                  description: 'Issues not assigned to any milestone',
                  sort_order: 9999,
                  progress: 0,
                }}
                issues={issues.filter(i => i.milestone_id === null)}
                expanded={expandedMilestones.has('__no_milestone__')}
                onToggle={() => toggleMilestone('__no_milestone__')}
              />
            )}
          </div>

          <div className={styles.importForm}>
            <h3 className={styles.importHeading}>Import as Saga</h3>
            <div className={styles.formRow}>
              <label className={styles.label}>Repositories</label>
              <RepoSelector repos={repos} selected={selectedRepos} onToggle={toggleRepo} />
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={styles.importButton}
                onClick={handleImport}
                disabled={selectedRepos.length === 0 || importing}
              >
                {importing ? 'Importing...' : 'Import as Saga'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
