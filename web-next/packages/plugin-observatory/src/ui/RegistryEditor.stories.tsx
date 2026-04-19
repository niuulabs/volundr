import type { Meta, StoryObj } from '@storybook/react';
import { userEvent, within } from '@storybook/test';
import { RegistryEditor } from './RegistryEditor';
import type { TypeRegistry } from '../domain/registry';

const STORY_REGISTRY: TypeRegistry = {
  version: 7,
  updatedAt: '2026-04-15T09:24:11Z',
  types: [
    {
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
      description: 'VLAN-scoped network zone — every entity lives in exactly one realm.',
      fields: [
        { key: 'vlan', label: 'VLAN', type: 'number', required: true },
        { key: 'dns', label: 'DNS zone', type: 'string', required: true },
      ],
    },
    {
      id: 'cluster',
      label: 'Cluster',
      rune: 'ᚲ',
      icon: 'layers',
      shape: 'ring-dashed',
      color: 'ice-200',
      size: 14,
      border: 'dashed',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'topology',
      description: 'Kubernetes cluster nested inside a realm.',
      fields: [{ key: 'nodes', label: 'Nodes', type: 'number' }],
    },
    {
      id: 'host',
      label: 'Host',
      rune: 'ᚦ',
      icon: 'server',
      shape: 'rounded-rect',
      color: 'slate-400',
      size: 22,
      border: 'solid',
      canContain: ['service'],
      parentTypes: ['realm'],
      category: 'hardware',
      description: 'Bare-metal or VM.',
      fields: [
        { key: 'os', label: 'OS', type: 'string' },
        { key: 'cores', label: 'Cores', type: 'number' },
      ],
    },
    {
      id: 'service',
      label: 'Service',
      rune: 'ᛦ',
      icon: 'box',
      shape: 'dot',
      color: 'ice-300',
      size: 8,
      border: 'solid',
      canContain: [],
      parentTypes: ['cluster', 'host'],
      category: 'infrastructure',
      description: 'Kubernetes workload.',
      fields: [
        {
          key: 'svcType',
          label: 'Type',
          type: 'select',
          options: ['auth', 'database', 'inference'],
        },
      ],
    },
    {
      id: 'ravn',
      label: 'Long-lived Ravn',
      rune: 'ᚱ',
      icon: 'bird',
      shape: 'diamond',
      color: 'brand',
      size: 11,
      border: 'solid',
      canContain: [],
      parentTypes: ['host', 'cluster'],
      category: 'agent',
      description: 'Persistent raven agent.',
      fields: [{ key: 'persona', label: 'Persona', type: 'string' }],
    },
  ],
};

const meta: Meta<typeof RegistryEditor> = {
  title: 'Observatory/RegistryEditor',
  component: RegistryEditor,
  parameters: {
    layout: 'fullscreen',
  },
  decorators: [
    (Story) => (
      <div style={{ padding: '24px', maxWidth: '960px', margin: '0 auto' }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof RegistryEditor>;

/** Types tab — default view with search and category groups */
export const TypesTabDefault: Story = {
  args: { registry: STORY_REGISTRY },
};

/** Containment tab — drag-drop tree showing the parent/child relationships */
export const ContainmentTabView: Story = {
  args: { registry: STORY_REGISTRY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Containment' }));
  },
};

/**
 * Containment tab — dragging state.
 * After dragStart on "Service", the node turns semi-transparent (dragging)
 * and other valid targets get drop-ok highlighted borders.
 */
export const ContainmentDragInProgress: Story = {
  args: { registry: STORY_REGISTRY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Containment' }));
    const serviceNode = canvas.getByRole('treeitem', { name: 'Service' });
    // Start drag — the story freezes here visually showing drag states
    serviceNode.dispatchEvent(
      new DragEvent('dragstart', {
        bubbles: true,
        dataTransfer: new DataTransfer(),
      }),
    );
  },
};

/** JSON tab — read-only pretty-printed registry with copy button */
export const JsonTabView: Story = {
  args: { registry: STORY_REGISTRY },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Json' }));
  },
};

/** Preview drawer empty state (no type selected initially) */
export const EmptyPreviewDrawer: Story = {
  args: {
    registry: { ...STORY_REGISTRY, types: [] },
  },
};
