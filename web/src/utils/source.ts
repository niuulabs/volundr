import type { SessionSource, GitSource } from '@/models';

export function isGitSource(source: SessionSource): source is GitSource {
  return source.type === 'git';
}

export function getRepo(source: SessionSource): string {
  return isGitSource(source) ? source.repo : '';
}

export function getBranch(source: SessionSource): string {
  return isGitSource(source) ? source.branch : '';
}

export function getSourceLabel(source: SessionSource): string {
  if (isGitSource(source)) {
    return source.repo || 'No repository';
  }
  const count = source.paths.length;
  return `${count} local mount${count !== 1 ? 's' : ''}`;
}
