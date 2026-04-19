import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Table, type ColumnDef, type SortState } from './Table';
import { StateDot } from '../../primitives/StateDot';
import { Chip } from '../../primitives/Chip';

interface Demo {
  id: string;
  name: string;
  status: 'healthy' | 'failed' | 'idle';
  score: number;
  region: string;
}

const data: Demo[] = [
  { id: '1', name: 'Skoll', status: 'healthy', score: 98, region: 'us-east' },
  { id: '2', name: 'Hati', status: 'healthy', score: 87, region: 'eu-west' },
  { id: '3', name: 'Saga', status: 'idle', score: 72, region: 'us-west' },
  { id: '4', name: 'Modi', status: 'failed', score: 0, region: 'ap-south' },
  { id: '5', name: 'Vali', status: 'healthy', score: 61, region: 'us-east' },
];

const columns: ColumnDef<Demo>[] = [
  {
    key: 'name',
    header: 'Region',
    cell: (r) => r.name,
    sortable: true,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <StateDot state={r.status} />
        {r.status}
      </div>
    ),
  },
  {
    key: 'score',
    header: 'Score',
    cell: (r) => (
      <Chip tone={r.score > 80 ? 'brand' : r.score === 0 ? 'critical' : 'default'}>{r.score}</Chip>
    ),
    sortable: true,
  },
  {
    key: 'region',
    header: 'Location',
    cell: (r) => r.region,
  },
];

const meta: Meta<typeof Table> = {
  title: 'Components/Table',
  component: Table,
};
export default meta;

type Story = StoryObj<typeof Table>;

export const Basic: Story = {
  render: () => (
    <Table columns={columns} rows={data} getRowKey={(r) => r.id} aria-label="Demo table" />
  ),
};

export const StickyHeader: Story = {
  render: () => (
    <div style={{ height: 200, overflow: 'auto' }}>
      <Table
        columns={columns}
        rows={data}
        getRowKey={(r) => r.id}
        stickyHeader
        aria-label="Sticky header table"
      />
    </div>
  ),
};

export const Sortable: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [sort, setSort] = useState<SortState>({ key: 'score', direction: 'desc' });
    const sorted = [...data].sort((a, b) => {
      const dir = sort.direction === 'asc' ? 1 : -1;
      if (sort.key === 'score') return (a.score - b.score) * dir;
      return a.name.localeCompare(b.name) * dir;
    });
    return (
      <Table
        columns={columns}
        rows={sorted}
        getRowKey={(r) => r.id}
        sortState={sort}
        onSortChange={setSort}
        aria-label="Sortable table"
      />
    );
  },
};

export const Selectable: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [selected, setSelected] = useState<Set<string>>(new Set());
    return (
      <div>
        <Table
          columns={columns}
          rows={data}
          getRowKey={(r) => r.id}
          selectable
          selectedKeys={selected}
          onSelectionChange={setSelected}
          aria-label="Selectable table"
        />
        <p
          style={{ marginTop: 8, color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)' }}
        >
          Selected: {selected.size > 0 ? [...selected].join(', ') : 'none'}
        </p>
      </div>
    );
  },
};

export const WithRowExpand: Story = {
  render: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    return (
      <Table
        columns={columns}
        rows={data}
        getRowKey={(r) => r.id}
        expandedKeys={expanded}
        onExpandChange={setExpanded}
        renderExpanded={(r) => (
          <div
            style={{
              padding: 'var(--space-3)',
              color: 'var(--color-text-secondary)',
              fontSize: 'var(--text-sm)',
            }}
          >
            Region ID: {r.id} · Location: {r.region} · Score: {r.score}
          </div>
        )}
        aria-label="Expandable table"
      />
    );
  },
};

export const EmptyState: Story = {
  render: () => (
    <Table
      columns={columns}
      rows={[]}
      getRowKey={(r) => r.id}
      emptyState={<span>No regions found</span>}
      aria-label="Empty table"
    />
  ),
};
