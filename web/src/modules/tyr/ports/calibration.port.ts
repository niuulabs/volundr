export interface CalibrationData {
  window_days: number;
  total_decisions: number;
  auto_approved: number;
  retried: number;
  escalated: number;
  divergence_rate: number;
  avg_confidence_approved: number;
  avg_confidence_reverted: number;
  pending_resolution: number;
}

export interface ReviewerConfig {
  reviewer_system_prompt: string;
}

export interface ICalibrationService {
  getCalibration(windowDays: number): Promise<CalibrationData>;
  getReviewerConfig(): Promise<ReviewerConfig>;
  updateReviewerConfig(prompt: string): Promise<void>;
}
