/**
 * Port for PTY (pseudo-terminal) streaming.
 *
 * Implementations may use WebSocket binary frames, SSE, or any other transport.
 * The UI calls `connect`, sends input via `write`, and streams output via `subscribe`.
 */

export interface PtyOutput {
  /** Raw terminal bytes (UTF-8 encoded). */
  readonly data: string;
  readonly timestamp: number;
}

export interface IPtyStream {
  /** Open a PTY connection for the given session. */
  connect(sessionId: string): Promise<void>;

  /** Send terminal input to the session. */
  write(sessionId: string, data: string): Promise<void>;

  /**
   * Subscribe to terminal output from the session.
   * @returns Unsubscribe function — must be called on unmount.
   */
  subscribe(sessionId: string, callback: (output: PtyOutput) => void): () => void;

  /** Close the PTY connection for the session. */
  disconnect(sessionId: string): Promise<void>;
}
