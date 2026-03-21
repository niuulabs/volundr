import { create } from 'zustand';
import type { Realm, Campaign, VolundrSession } from '@/modules/volundr/models';

type ModalType = 'realm-detail' | 'session-new' | 'session-detail' | null;

interface AppState {
  // UI State
  voiceEnabled: boolean;
  sidebarCollapsed: boolean;

  // Selected entities
  selectedRealm: Realm | null;
  selectedCampaign: Campaign | null;
  selectedSession: VolundrSession | null;

  // Modal state
  activeModal: ModalType;

  // Actions
  setVoiceEnabled: (enabled: boolean) => void;
  toggleVoice: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;

  setSelectedRealm: (realm: Realm | null) => void;
  setSelectedCampaign: (campaign: Campaign | null) => void;
  setSelectedSession: (session: VolundrSession | null) => void;

  openModal: (modal: ModalType) => void;
  closeModal: () => void;

  // Compound actions
  openRealmDetail: (realm: Realm) => void;
  openSessionDetail: (session: VolundrSession) => void;
}

export const useAppStore = create<AppState>(set => ({
  // Initial state
  voiceEnabled: false,
  sidebarCollapsed: false,
  selectedRealm: null,
  selectedCampaign: null,
  selectedSession: null,
  activeModal: null,

  // Voice actions
  setVoiceEnabled: enabled => set({ voiceEnabled: enabled }),
  toggleVoice: () => set(state => ({ voiceEnabled: !state.voiceEnabled })),

  // Sidebar actions
  setSidebarCollapsed: collapsed => set({ sidebarCollapsed: collapsed }),
  toggleSidebar: () => set(state => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  // Selection actions
  setSelectedRealm: realm => set({ selectedRealm: realm }),
  setSelectedCampaign: campaign => set({ selectedCampaign: campaign }),
  setSelectedSession: session => set({ selectedSession: session }),

  // Modal actions
  openModal: modal => set({ activeModal: modal }),
  closeModal: () => set({ activeModal: null }),

  // Compound actions
  openRealmDetail: realm => set({ selectedRealm: realm, activeModal: 'realm-detail' }),
  openSessionDetail: session => set({ selectedSession: session, activeModal: 'session-detail' }),
}));
