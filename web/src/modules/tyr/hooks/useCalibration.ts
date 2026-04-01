import { useState, useEffect, useCallback } from 'react';
import type { CalibrationData } from '../ports/calibration.port';
import { calibrationService } from '../adapters';

interface UseCalibrationResult {
  data: CalibrationData | null;
  loading: boolean;
  error: string | null;
  windowDays: number;
  setWindowDays: (days: number) => void;
  reviewerPrompt: string;
  promptLoading: boolean;
  savingPrompt: boolean;
  loadPrompt: () => void;
  savePrompt: (prompt: string) => Promise<void>;
}

export function useCalibration(): UseCalibrationResult {
  const [data, setData] = useState<CalibrationData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [windowDays, setWindowDays] = useState(30);
  const [reviewerPrompt, setReviewerPrompt] = useState('');
  const [promptLoading, setPromptLoading] = useState(false);
  const [savingPrompt, setSavingPrompt] = useState(false);

  const fetchCalibration = useCallback((days: number) => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    calibrationService
      .getCalibration(days)
      .then(result => {
        if (!cancelled) setData(result);
      })
      .catch(e => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return fetchCalibration(windowDays);
  }, [windowDays, fetchCalibration]);

  const handleSetWindowDays = useCallback((days: number) => {
    setWindowDays(days);
  }, []);

  const loadPrompt = useCallback(() => {
    setPromptLoading(true);
    calibrationService
      .getReviewerConfig()
      .then(config => setReviewerPrompt(config.reviewer_system_prompt))
      .catch(() => {})
      .finally(() => setPromptLoading(false));
  }, []);

  const savePrompt = useCallback(async (prompt: string) => {
    setSavingPrompt(true);
    try {
      await calibrationService.updateReviewerConfig(prompt);
      setReviewerPrompt(prompt);
    } finally {
      setSavingPrompt(false);
    }
  }, []);

  return {
    data,
    loading,
    error,
    windowDays,
    setWindowDays: handleSetWindowDays,
    reviewerPrompt,
    promptLoading,
    savingPrompt,
    loadPrompt,
    savePrompt,
  };
}
