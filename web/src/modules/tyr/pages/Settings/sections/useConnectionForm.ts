import { useState } from 'react';

interface UseConnectionFormResult {
  error: string | null;
  submitting: boolean;
  disconnecting: boolean;
  setError: (error: string | null) => void;
  handleDisconnect: () => Promise<void>;
  wrapSubmit: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}

export function useConnectionForm(
  connectionId: string | null,
  onDisconnect: (id: string) => Promise<void>,
): UseConnectionFormResult {
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleDisconnect = async () => {
    if (!connectionId) return;
    setError(null);
    setDisconnecting(true);
    try {
      await onDisconnect(connectionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    } finally {
      setDisconnecting(false);
    }
  };

  const wrapSubmit = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setError(null);
    setSubmitting(true);
    try {
      return await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect');
      return undefined;
    } finally {
      setSubmitting(false);
    }
  };

  return { error, submitting, disconnecting, setError, handleDisconnect, wrapSubmit };
}
