import type { MimirStats, MimirConsultation } from '@/models';

/**
 * Port interface for Mímir service
 * Manages Claude API consultations
 */
export interface IMimirService {
  /**
   * Get Mímir statistics
   */
  getStats(): Promise<MimirStats>;

  /**
   * Get recent consultations
   * @param limit Maximum number of consultations to return
   */
  getConsultations(limit?: number): Promise<MimirConsultation[]>;

  /**
   * Get a specific consultation by ID
   */
  getConsultation(id: string): Promise<MimirConsultation | null>;

  /**
   * Subscribe to new consultations
   * @returns Unsubscribe function
   */
  subscribe(callback: (consultation: MimirConsultation) => void): () => void;

  /**
   * Mark a consultation as useful/not useful
   */
  rateConsultation(consultationId: string, useful: boolean): Promise<void>;
}
