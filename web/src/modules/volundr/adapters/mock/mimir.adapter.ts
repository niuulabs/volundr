import type { IMimirService } from '@/modules/volundr/ports';
import type { MimirStats, MimirConsultation } from '@/modules/volundr/models';
import { mockMimirStats, mockMimirConsultations } from './data';

/**
 * Mock implementation of IMimirService
 * Returns canned data for development and testing
 */
export class MockMimirService implements IMimirService {
  private stats: MimirStats = { ...mockMimirStats };
  private consultations: MimirConsultation[] = mockMimirConsultations.map(c => ({
    ...c,
  }));
  private subscribers: Set<(consultation: MimirConsultation) => void> = new Set();

  async getStats(): Promise<MimirStats> {
    return { ...this.stats };
  }

  async getConsultations(limit = 50): Promise<MimirConsultation[]> {
    return this.consultations.slice(0, limit).map(c => ({ ...c }));
  }

  async getConsultation(id: string): Promise<MimirConsultation | null> {
    const consultation = this.consultations.find(c => c.id === id);
    return consultation ? { ...consultation } : null;
  }

  subscribe(callback: (consultation: MimirConsultation) => void): () => void {
    this.subscribers.add(callback);
    return () => {
      this.subscribers.delete(callback);
    };
  }

  async rateConsultation(consultationId: string, useful: boolean): Promise<void> {
    const consultation = this.consultations.find(c => c.id === consultationId);
    if (consultation) {
      consultation.useful = useful;
    }
  }
}
