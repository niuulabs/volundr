import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Table, type ColumnDef } from './Table';

interface Row {
  id: string;
  name: string;
  score: number;
}

const rows: Row[] = [
  { id: '1', name: 'Alpha', score: 10 },
  { id: '2', name: 'Beta', score: 5 },
  { id: '3', name: 'Gamma', score: 20 },
];

const columns: ColumnDef<Row>[] = [
  { key: 'name', header: 'Name', cell: (r) => r.name, sortable: true },
  { key: 'score', header: 'Score', cell: (r) => r.score, sortable: true },
];

describe('Table', () => {
  it('renders column headers', () => {
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('renders row data', () => {
    render(<Table columns={columns} rows={rows} getRowKey={(r) => r.id} />);
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('calls onSortChange ascending when clicking unsorted column header', () => {
    const onSortChange = vi.fn();
    render(
      <Table columns={columns} rows={rows} getRowKey={(r) => r.id} onSortChange={onSortChange} />,
    );
    fireEvent.click(screen.getByText('Name').closest('th')!);
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'asc' });
  });

  it('toggles sort direction to desc on second click', () => {
    const onSortChange = vi.fn();
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        sortState={{ key: 'name', direction: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    fireEvent.click(screen.getByText('Name').closest('th')!);
    expect(onSortChange).toHaveBeenCalledWith({ key: 'name', direction: 'desc' });
  });

  it('sets aria-sort on sorted column', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        sortState={{ key: 'name', direction: 'asc' }}
      />,
    );
    const nameHeader = screen.getByText('Name').closest('th');
    expect(nameHeader).toHaveAttribute('aria-sort', 'ascending');
  });

  it('renders select-all checkbox when selectable', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Select all rows')).toBeInTheDocument();
  });

  it('calls onSelectionChange with all keys when select-all is clicked', () => {
    const onSelectionChange = vi.fn();
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select all rows'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1', '2', '3']));
  });

  it('calls onSelectionChange deselecting all when all selected', () => {
    const onSelectionChange = vi.fn();
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        selectable
        selectedKeys={new Set(['1', '2', '3'])}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select all rows'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set());
  });

  it('calls onSelectionChange toggling individual row', () => {
    const onSelectionChange = vi.fn();
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        selectable
        selectedKeys={new Set()}
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getByLabelText('Select row 1'));
    expect(onSelectionChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('renders expand buttons when renderExpanded is provided', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        expandedKeys={new Set()}
        onExpandChange={vi.fn()}
        renderExpanded={(r) => <div>Details for {r.name}</div>}
      />,
    );
    const expandBtns = screen.getAllByLabelText('Expand row');
    expect(expandBtns).toHaveLength(3);
  });

  it('shows expanded content when row is in expandedKeys', () => {
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        expandedKeys={new Set(['1'])}
        onExpandChange={vi.fn()}
        renderExpanded={(r) => <div>Details for {r.name}</div>}
      />,
    );
    expect(screen.getByText('Details for Alpha')).toBeInTheDocument();
  });

  it('calls onExpandChange when expand button clicked', () => {
    const onExpandChange = vi.fn();
    render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        expandedKeys={new Set()}
        onExpandChange={onExpandChange}
        renderExpanded={(r) => <div>Details for {r.name}</div>}
      />,
    );
    fireEvent.click(screen.getAllByLabelText('Expand row')[0]!);
    expect(onExpandChange).toHaveBeenCalledWith(new Set(['1']));
  });

  it('shows emptyState when rows is empty', () => {
    render(
      <Table
        columns={columns}
        rows={[]}
        getRowKey={(r) => r.id}
        emptyState={<span>No data</span>}
      />,
    );
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('applies stickyHeader class when stickyHeader is true', () => {
    const { container } = render(
      <Table columns={columns} rows={rows} getRowKey={(r) => r.id} stickyHeader />,
    );
    expect(container.querySelector('.niuu-table--sticky-header')).toBeInTheDocument();
  });

  it('applies selected row class', () => {
    const { container } = render(
      <Table
        columns={columns}
        rows={rows}
        getRowKey={(r) => r.id}
        selectable
        selectedKeys={new Set(['1'])}
        onSelectionChange={vi.fn()}
      />,
    );
    const selectedRows = container.querySelectorAll('.niuu-table__row--selected');
    expect(selectedRows).toHaveLength(1);
  });
});
