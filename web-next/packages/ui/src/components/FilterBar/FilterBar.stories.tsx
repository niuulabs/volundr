import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { FilterBar, FilterChip, FilterToggle } from './FilterBar';

const meta: Meta<typeof FilterBar> = {
  title: 'Components/FilterBar',
  component: FilterBar,
};
export default meta;

type Story = StoryObj<typeof FilterBar>;

export const SearchOnly: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [q, setQ] = useState('');
    return <FilterBar searchValue={q} onSearchChange={setQ} searchPlaceholder="Search sessions…" />;
  },
};

export const WithChips: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [q, setQ] = useState('');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [filters, setFilters] = useState<Record<string, string | undefined>>({
      status: 'running',
      persona: 'builder',
    });

    function removeFilter(key: string) {
      setFilters((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }

    return (
      <FilterBar searchValue={q} onSearchChange={setQ}>
        {Object.entries(filters).map(([k, v]) => (
          <FilterChip key={k} label={k} value={v} onRemove={() => removeFilter(k)} />
        ))}
      </FilterBar>
    );
  },
};

export const WithToggles: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [q, setQ] = useState('');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [pinned, setPinned] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [failing, setFailing] = useState(false);

    return (
      <FilterBar searchValue={q} onSearchChange={setQ}>
        <FilterToggle label="Pinned" active={pinned} onToggle={setPinned} />
        <FilterToggle label="Failing" active={failing} onToggle={setFailing} />
      </FilterBar>
    );
  },
};

export const FullFeatured: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [q, setQ] = useState('');
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [pinned, setPinned] = useState(false);
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [statusFilter, setStatusFilter] = useState<string | undefined>('running');

    return (
      <FilterBar
        searchValue={q}
        onSearchChange={setQ}
        actions={
          <button type="button" style={{ fontSize: 11 }}>
            ⬇ Export
          </button>
        }
      >
        {statusFilter && (
          <FilterChip
            label="status"
            value={statusFilter}
            onRemove={() => setStatusFilter(undefined)}
          />
        )}
        <FilterToggle label="Pinned" active={pinned} onToggle={setPinned} />
      </FilterBar>
    );
  },
};
