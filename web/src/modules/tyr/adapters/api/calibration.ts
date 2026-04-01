import { createApiClient } from '@/modules/shared/api/client';
import type {
  ICalibrationService,
  CalibrationData,
  ReviewerConfig,
} from '../../ports/calibration.port';

const api = createApiClient('/api/v1/tyr');

export class ApiCalibrationService implements ICalibrationService {
  async getCalibration(windowDays: number): Promise<CalibrationData> {
    return api.get<CalibrationData>(`/reviewer/calibration?window_days=${windowDays}`);
  }

  async getReviewerConfig(): Promise<ReviewerConfig> {
    const data = await api.get<ReviewerConfig>('/config');
    return data;
  }

  async updateReviewerConfig(prompt: string): Promise<void> {
    await api.patch('/config', { reviewer_system_prompt: prompt });
  }
}
