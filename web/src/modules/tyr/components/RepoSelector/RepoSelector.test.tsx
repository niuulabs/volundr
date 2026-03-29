import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepoSelector } from './RepoSelector';
import type { RepoInfo, SelectedRepo } from '../../models';

const mockRepos: RepoInfo[] = [
  {
    provider: 'github',
    org: 'niuu',
    name: 'volundr',
    clone_url: 'https://github.com/niuu/volundr.git',
    url: 'https://github.com/niuu/volundr',
    default_branch: 'main',
    branches: ['main', 'dev'],
  },
  {
    provider: 'gitlab',
    org: 'niuu',
    name: 'frontend',
    clone_url: 'https://gitlab.com/niuu/frontend.git',
    url: 'https://gitlab.com/niuu/frontend',
    default_branch: 'main',
    branches: ['main'],
  },
];

describe('RepoSelector — multi-select mode', () => {
  let onToggle: ReturnType<typeof vi.fn>;
  let onBranchChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onToggle = vi.fn();
    onBranchChange = vi.fn();
  });

  it('renders empty state when no repos', () => {
    render(
      <RepoSelector repos={[]} selected={[]} onToggle={onToggle} onBranchChange={onBranchChange} />
    );
    expect(screen.getByText('No repositories available')).toBeInTheDocument();
  });

  it('shows dropdown on focus with available repos', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        repos={mockRepos}
        selected={[]}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    const input = screen.getByPlaceholderText(/search and select repositories/i);
    await user.click(input);

    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('calls onToggle when clicking a repo in multi mode', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        repos={mockRepos}
        selected={[]}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    await user.click(screen.getByPlaceholderText(/search and select repositories/i));
    await user.click(screen.getByText('niuu/volundr'));

    expect(onToggle).toHaveBeenCalledWith('https://github.com/niuu/volundr');
  });

  it('filters dropdown by search term', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        repos={mockRepos}
        selected={[]}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    const input = screen.getByPlaceholderText(/search and select repositories/i);
    await user.type(input, 'frontend');

    expect(screen.queryByText('niuu/volundr')).not.toBeInTheDocument();
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('shows no results message for unmatched search', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        repos={mockRepos}
        selected={[]}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    const input = screen.getByPlaceholderText(/search and select repositories/i);
    await user.type(input, 'nonexistent');

    expect(screen.getByText('No matching repositories')).toBeInTheDocument();
  });

  it('excludes already-selected repos from dropdown', async () => {
    const user = userEvent.setup();
    const selected: SelectedRepo[] = [
      { repoId: 'https://github.com/niuu/volundr', branch: 'main' },
    ];
    render(
      <RepoSelector
        repos={mockRepos}
        selected={selected}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    await user.click(screen.getByPlaceholderText(/search and select repositories/i));

    // volundr should not be in the dropdown (already selected)
    const dropdownButtons = screen.getAllByRole('button');
    const dropdownTexts = dropdownButtons.map(b => b.textContent);
    expect(dropdownTexts.some(t => t?.includes('niuu/volundr'))).toBe(false);
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('renders selected list with branch select and remove button', () => {
    const selected: SelectedRepo[] = [
      { repoId: 'https://github.com/niuu/volundr', branch: 'main' },
    ];
    render(
      <RepoSelector
        repos={mockRepos}
        selected={selected}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'main' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'dev' })).toBeInTheDocument();
    expect(screen.getByLabelText(/remove/i)).toBeInTheDocument();
  });

  it('calls onBranchChange when changing branch', async () => {
    const user = userEvent.setup();
    const selected: SelectedRepo[] = [
      { repoId: 'https://github.com/niuu/volundr', branch: 'main' },
    ];
    render(
      <RepoSelector
        repos={mockRepos}
        selected={selected}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    await user.selectOptions(screen.getByRole('combobox'), 'dev');

    expect(onBranchChange).toHaveBeenCalledWith('https://github.com/niuu/volundr', 'dev');
  });

  it('calls onToggle when clicking remove button', async () => {
    const user = userEvent.setup();
    const selected: SelectedRepo[] = [
      { repoId: 'https://github.com/niuu/volundr', branch: 'main' },
    ];
    render(
      <RepoSelector
        repos={mockRepos}
        selected={selected}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
      />
    );

    await user.click(screen.getByLabelText(/remove/i));
    expect(onToggle).toHaveBeenCalledWith('https://github.com/niuu/volundr');
  });

  it('hides branch in dropdown when showBranch is false', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        repos={mockRepos}
        selected={[]}
        onToggle={onToggle}
        onBranchChange={onBranchChange}
        showBranch={false}
      />
    );

    await user.click(screen.getByPlaceholderText(/search and select repositories/i));

    // Provider badges should exist but branch text should not
    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });
});

describe('RepoSelector — single-select mode', () => {
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onSelect = vi.fn();
  });

  it('shows dropdown on focus', async () => {
    const user = userEvent.setup();
    render(<RepoSelector mode="single" repos={mockRepos} onSelect={onSelect} />);

    await user.click(screen.getByPlaceholderText(/search and select a repository/i));

    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('calls onSelect with repo URL and closes dropdown on click', async () => {
    const user = userEvent.setup();
    render(<RepoSelector mode="single" repos={mockRepos} onSelect={onSelect} />);

    await user.click(screen.getByPlaceholderText(/search and select a repository/i));
    await user.click(screen.getByText('niuu/volundr'));

    expect(onSelect).toHaveBeenCalledWith('https://github.com/niuu/volundr');
    // Dropdown should be closed
    expect(screen.queryByText('niuu/frontend')).not.toBeInTheDocument();
  });

  it('does not show selected list below in single mode', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        mode="single"
        repos={mockRepos}
        value="https://github.com/niuu/volundr"
        onSelect={onSelect}
      />
    );

    // No remove buttons should exist (no selected list)
    expect(screen.queryByLabelText(/remove/i)).not.toBeInTheDocument();

    // Input should show selected repo name when not focused
    const input = screen.getByPlaceholderText(
      /search and select a repository/i
    ) as HTMLInputElement;
    expect(input.value).toBe('niuu/volundr');

    // When focused, search should be empty for typing
    await user.click(input);
    expect(input.value).toBe('');
  });

  it('filters repos by search in single mode', async () => {
    const user = userEvent.setup();
    render(<RepoSelector mode="single" repos={mockRepos} onSelect={onSelect} />);

    const input = screen.getByPlaceholderText(/search and select a repository/i);
    await user.type(input, 'front');

    expect(screen.queryByText('niuu/volundr')).not.toBeInTheDocument();
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('shows all repos in dropdown (no exclusion like multi mode)', async () => {
    const user = userEvent.setup();
    render(
      <RepoSelector
        mode="single"
        repos={mockRepos}
        value="https://github.com/niuu/volundr"
        onSelect={onSelect}
      />
    );

    const input = screen.getByPlaceholderText(/search and select a repository/i);
    await user.click(input);

    // Both repos should be visible even though one is selected
    expect(screen.getByText('niuu/volundr')).toBeInTheDocument();
    expect(screen.getByText('niuu/frontend')).toBeInTheDocument();
  });

  it('hides branch in dropdown when showBranch is false', async () => {
    const user = userEvent.setup();
    render(<RepoSelector mode="single" repos={mockRepos} onSelect={onSelect} showBranch={false} />);

    await user.click(screen.getByPlaceholderText(/search and select a repository/i));

    expect(screen.getByText('github')).toBeInTheDocument();
    expect(screen.queryByText('main')).not.toBeInTheDocument();
  });

  it('renders empty state when no repos', () => {
    render(<RepoSelector mode="single" repos={[]} onSelect={onSelect} />);
    expect(screen.getByText('No repositories available')).toBeInTheDocument();
  });
});
