import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Inline type declarations for the Web Speech API.
 * These are not always available in TypeScript's global types.
 */
interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  readonly length: number;
  readonly isFinal: boolean;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionInstance;
}

interface UseSpeechRecognitionOptions {
  /** Called with accumulated transcript text whenever recognition produces results */
  onTranscript?: (text: string) => void;
}

interface UseSpeechRecognitionReturn {
  isListening: boolean;
  transcript: string;
  startListening: () => void;
  stopListening: () => void;
  isSupported: boolean;
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const win = window as unknown as Record<string, unknown>;

  if (typeof win.SpeechRecognition === 'function') {
    return win.SpeechRecognition as unknown as SpeechRecognitionConstructor;
  }

  if (typeof win.webkitSpeechRecognition === 'function') {
    return win.webkitSpeechRecognition as unknown as SpeechRecognitionConstructor;
  }

  return null;
}

/**
 * Hook that wraps the Web Speech API for speech-to-text recognition.
 *
 * Returns controls for starting/stopping recognition and the accumulated
 * transcript from the current session.
 */
export function useSpeechRecognition(
  options?: UseSpeechRecognitionOptions
): UseSpeechRecognitionReturn {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');

  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const isListeningRef = useRef(false);
  const onTranscriptRef = useRef(options?.onTranscript);
  useEffect(() => {
    onTranscriptRef.current = options?.onTranscript;
  }, [options?.onTranscript]);

  const isSupported = typeof window !== 'undefined' && getSpeechRecognitionConstructor() !== null;

  const stopListening = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    recognitionRef.current.stop();
    isListeningRef.current = false;
    setIsListening(false);
  }, []);

  const startListening = useCallback(() => {
    const Constructor = getSpeechRecognitionConstructor();
    if (!Constructor) {
      return;
    }

    // Stop any existing session before starting a new one
    if (recognitionRef.current) {
      recognitionRef.current.abort();
      recognitionRef.current = null;
    }

    const recognition = new Constructor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    let finalTranscript = '';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (!result) continue;
        const alt = result[0];
        if (!alt) continue;
        if (result.isFinal) {
          finalTranscript += alt.transcript;
        } else {
          interim += alt.transcript;
        }
      }

      const combined = finalTranscript + interim;
      setTranscript(combined);
      onTranscriptRef.current?.(combined);
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      // "aborted" is expected when we call stop/abort intentionally
      if (event.error === 'aborted') {
        return;
      }

      console.warn('Speech recognition error:', event.error, event.message);
      isListeningRef.current = false;
      setIsListening(false);
    };

    recognition.onend = () => {
      isListeningRef.current = false;
      setIsListening(false);
      recognitionRef.current = null;
    };

    recognitionRef.current = recognition;
    isListeningRef.current = true;
    setTranscript('');
    setIsListening(true);

    recognition.start();
  }, []);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (!recognitionRef.current) {
        return;
      }

      recognitionRef.current.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    isListening,
    transcript,
    startListening,
    stopListening,
    isSupported,
  };
}
