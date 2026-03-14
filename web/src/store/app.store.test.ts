import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './app.store';
import type { Realm, Campaign, VolundrSession } from '@/models';

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useAppStore.setState({
      voiceEnabled: false,
      sidebarCollapsed: false,
      selectedRealm: null,
      selectedCampaign: null,
      selectedSession: null,
      activeModal: null,
    });
  });

  describe('voice controls', () => {
    it('should initialize with voice disabled', () => {
      const state = useAppStore.getState();
      expect(state.voiceEnabled).toBe(false);
    });

    it('should set voice enabled', () => {
      useAppStore.getState().setVoiceEnabled(true);
      expect(useAppStore.getState().voiceEnabled).toBe(true);
    });

    it('should toggle voice', () => {
      expect(useAppStore.getState().voiceEnabled).toBe(false);
      useAppStore.getState().toggleVoice();
      expect(useAppStore.getState().voiceEnabled).toBe(true);
      useAppStore.getState().toggleVoice();
      expect(useAppStore.getState().voiceEnabled).toBe(false);
    });
  });

  describe('sidebar controls', () => {
    it('should initialize with sidebar expanded', () => {
      const state = useAppStore.getState();
      expect(state.sidebarCollapsed).toBe(false);
    });

    it('should set sidebar collapsed', () => {
      useAppStore.getState().setSidebarCollapsed(true);
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
    });

    it('should toggle sidebar', () => {
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(true);
      useAppStore.getState().toggleSidebar();
      expect(useAppStore.getState().sidebarCollapsed).toBe(false);
    });
  });

  describe('selection actions', () => {
    const mockRealm: Realm = {
      id: 'valhalla',
      name: 'Valhalla',
      description: 'AI/ML GPU cluster',
      location: 'ca-hamilton-1',
      status: 'healthy',
      health: {
        status: 'healthy',
        inputs: {
          nodesReady: 3,
          nodesTotal: 3,
          podRunningRatio: 1.0,
          volumesDegraded: 0,
          volumesFaulted: 0,
          recentErrorCount: 0,
        },
        reason: '',
      },
      resources: {
        cpu: { capacity: 48, allocatable: 44, unit: 'cores' },
        memory: { capacity: 384, allocatable: 360, unit: 'GiB' },
        gpuCount: 6,
        pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
      },
      valkyrie: null,
    };

    const mockCampaign: Campaign = {
      id: 'campaign-001',
      name: 'Test Campaign',
      description: 'Test description',
      status: 'active',
      progress: 50,
      confidence: 0.8,
      mergeThreshold: 0.85,
      phases: [],
      einherjar: [],
      started: '2024-01-23T08:13:00Z',
      eta: '~45m',
      repoAccess: [],
    };

    const mockSession: VolundrSession = {
      id: 'session-001',
      name: 'Test Session',
      source: { type: 'git', repo: 'odin-core', branch: 'main' },
      status: 'running',
      model: 'claude-sonnet',
      lastActive: Date.now(),
      messageCount: 10,
      tokensUsed: 5000,
    };

    it('should set selected realm', () => {
      useAppStore.getState().setSelectedRealm(mockRealm);
      expect(useAppStore.getState().selectedRealm).toEqual(mockRealm);
    });

    it('should clear selected realm', () => {
      useAppStore.getState().setSelectedRealm(mockRealm);
      useAppStore.getState().setSelectedRealm(null);
      expect(useAppStore.getState().selectedRealm).toBeNull();
    });

    it('should set selected campaign', () => {
      useAppStore.getState().setSelectedCampaign(mockCampaign);
      expect(useAppStore.getState().selectedCampaign).toEqual(mockCampaign);
    });

    it('should set selected session', () => {
      useAppStore.getState().setSelectedSession(mockSession);
      expect(useAppStore.getState().selectedSession).toEqual(mockSession);
    });
  });

  describe('modal actions', () => {
    it('should initialize with no modal', () => {
      expect(useAppStore.getState().activeModal).toBeNull();
    });

    it('should open modal', () => {
      useAppStore.getState().openModal('realm-detail');
      expect(useAppStore.getState().activeModal).toBe('realm-detail');
    });

    it('should close modal', () => {
      useAppStore.getState().openModal('realm-detail');
      useAppStore.getState().closeModal();
      expect(useAppStore.getState().activeModal).toBeNull();
    });
  });

  describe('compound actions', () => {
    const mockRealm: Realm = {
      id: 'valhalla',
      name: 'Valhalla',
      description: 'AI/ML GPU cluster',
      location: 'ca-hamilton-1',
      status: 'healthy',
      health: {
        status: 'healthy',
        inputs: {
          nodesReady: 3,
          nodesTotal: 3,
          podRunningRatio: 1.0,
          volumesDegraded: 0,
          volumesFaulted: 0,
          recentErrorCount: 0,
        },
        reason: '',
      },
      resources: {
        cpu: { capacity: 48, allocatable: 44, unit: 'cores' },
        memory: { capacity: 384, allocatable: 360, unit: 'GiB' },
        gpuCount: 6,
        pods: { running: 14, pending: 1, failed: 0, succeeded: 3, unknown: 0 },
      },
      valkyrie: null,
    };

    const mockSession: VolundrSession = {
      id: 'session-001',
      name: 'Test Session',
      source: { type: 'git', repo: 'odin-core', branch: 'main' },
      status: 'running',
      model: 'claude-sonnet',
      lastActive: Date.now(),
      messageCount: 10,
      tokensUsed: 5000,
    };

    it('should open realm detail with realm selected', () => {
      useAppStore.getState().openRealmDetail(mockRealm);
      const state = useAppStore.getState();
      expect(state.selectedRealm).toEqual(mockRealm);
      expect(state.activeModal).toBe('realm-detail');
    });

    it('should open session detail with session selected', () => {
      useAppStore.getState().openSessionDetail(mockSession);
      const state = useAppStore.getState();
      expect(state.selectedSession).toEqual(mockSession);
      expect(state.activeModal).toBe('session-detail');
    });
  });
});
