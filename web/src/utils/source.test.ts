import { describe, it, expect } from 'vitest';
import type { GitSource, LocalMountSource } from '@/models';
import { isGitSource, getRepo, getBranch, getSourceLabel } from './source';

const gitSource: GitSource = {
  type: 'git',
  repo: 'https://github.com/org/repo',
  branch: 'main',
};

const localSource: LocalMountSource = {
  type: 'local_mount',
  paths: [{ host_path: '/home/user/code', mount_path: '/workspace', read_only: true }],
};

describe('isGitSource', () => {
  it('returns true for git source', () => {
    expect(isGitSource(gitSource)).toBe(true);
  });

  it('returns false for local mount source', () => {
    expect(isGitSource(localSource)).toBe(false);
  });
});

describe('getRepo', () => {
  it('returns repo for git source', () => {
    expect(getRepo(gitSource)).toBe('https://github.com/org/repo');
  });

  it('returns empty string for local mount source', () => {
    expect(getRepo(localSource)).toBe('');
  });
});

describe('getBranch', () => {
  it('returns branch for git source', () => {
    expect(getBranch(gitSource)).toBe('main');
  });

  it('returns empty string for local mount source', () => {
    expect(getBranch(localSource)).toBe('');
  });
});

describe('getSourceLabel', () => {
  it('returns repo URL for git source', () => {
    expect(getSourceLabel(gitSource)).toBe('https://github.com/org/repo');
  });

  it('returns "No repository" for git source with empty repo', () => {
    const noRepo: GitSource = { type: 'git', repo: '', branch: 'main' };
    expect(getSourceLabel(noRepo)).toBe('No repository');
  });

  it('returns mount count for single local mount', () => {
    expect(getSourceLabel(localSource)).toBe('1 local mount');
  });

  it('returns pluralized mount count for multiple mounts', () => {
    const multiMount: LocalMountSource = {
      type: 'local_mount',
      paths: [
        { host_path: '/a', mount_path: '/wa', read_only: true },
        { host_path: '/b', mount_path: '/wb', read_only: false },
      ],
    };
    expect(getSourceLabel(multiMount)).toBe('2 local mounts');
  });

  it('returns directory name for local_path source', () => {
    const localPath: LocalMountSource = {
      type: 'local_mount',
      local_path: '/home/user/projects/my-app',
      paths: [],
    };
    expect(getSourceLabel(localPath)).toBe('my-app');
  });

  it('returns full path when local_path has no directory component', () => {
    const localPath: LocalMountSource = {
      type: 'local_mount',
      local_path: 'my-app',
      paths: [],
    };
    expect(getSourceLabel(localPath)).toBe('my-app');
  });

  it('handles trailing slash in local_path', () => {
    const localPath: LocalMountSource = {
      type: 'local_mount',
      local_path: '/home/user/projects/my-app/',
      paths: [],
    };
    expect(getSourceLabel(localPath)).toBe('my-app');
  });

  it('returns full local_path when path is root "/"', () => {
    const localPath: LocalMountSource = {
      type: 'local_mount',
      local_path: '/',
      paths: [],
    };
    expect(getSourceLabel(localPath)).toBe('/');
  });

  it('returns "0 local mounts" for empty paths without local_path', () => {
    const emptyMount: LocalMountSource = {
      type: 'local_mount',
      paths: [],
    };
    expect(getSourceLabel(emptyMount)).toBe('0 local mounts');
  });
});
