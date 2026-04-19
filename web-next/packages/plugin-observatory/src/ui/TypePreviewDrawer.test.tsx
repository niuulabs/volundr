import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TypePreviewDrawer } from './TypePreviewDrawer';
import type { EntityType } from '@niuulabs/domain';

const REALM_TYPE: EntityType = {
  id: 'realm',
  label: 'Realm',
  rune: 'ᛞ',
  icon: 'globe',
  shape: 'ring',
  color: 'ice-100',
  size: 18,
  border: 'solid',
  canContain: ['cluster', 'host'],
  parentTypes: [],
  category: 'topology',
  description: 'VLAN-scoped network zone.',
  fields: [
    { key: 'vlan', label: 'VLAN', type: 'number', required: true },
    { key: 'dns', label: 'DNS zone', type: 'string' },
  ],
};

describe('TypePreviewDrawer', () => {
  it('shows placeholder when type is undefined', () => {
    render(<TypePreviewDrawer type={undefined} />);
    expect(screen.getByText('Select a type to preview.')).toBeInTheDocument();
  });

  it('renders the type label', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('Realm')).toBeInTheDocument();
  });

  it('renders the type id', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('realm')).toBeInTheDocument();
  });

  it('renders the category', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('Type · topology')).toBeInTheDocument();
  });

  it('renders the description', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('VLAN-scoped network zone.')).toBeInTheDocument();
  });

  it('renders canContain chips', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('cluster')).toBeInTheDocument();
    expect(screen.getByText('host')).toBeInTheDocument();
  });

  it('does not render "Can contain" section when empty', () => {
    const leafType: EntityType = { ...REALM_TYPE, canContain: [] };
    render(<TypePreviewDrawer type={leafType} />);
    expect(screen.queryByText('Can contain')).not.toBeInTheDocument();
  });

  it('does not render "Lives inside" section when parentTypes is empty', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.queryByText('Lives inside')).not.toBeInTheDocument();
  });

  it('renders parentTypes chips when present', () => {
    const clusterType: EntityType = { ...REALM_TYPE, parentTypes: ['realm'] };
    render(<TypePreviewDrawer type={clusterType} />);
    expect(screen.getByText('Lives inside')).toBeInTheDocument();
    // 'realm' appears in both the id field and the parentTypes chip
    expect(screen.getAllByText('realm').length).toBeGreaterThanOrEqual(1);
  });

  it('renders fields with their types', () => {
    render(<TypePreviewDrawer type={REALM_TYPE} />);
    expect(screen.getByText('Fields')).toBeInTheDocument();
    expect(screen.getByText('VLAN')).toBeInTheDocument();
    expect(screen.getByText('DNS zone')).toBeInTheDocument();
    expect(screen.getAllByText('number').length).toBeGreaterThan(0);
    expect(screen.getAllByText('string').length).toBeGreaterThan(0);
  });

  it('does not render Fields section when fields is empty', () => {
    const noFields: EntityType = { ...REALM_TYPE, fields: [] };
    render(<TypePreviewDrawer type={noFields} />);
    expect(screen.queryByText('Fields')).not.toBeInTheDocument();
  });
});
