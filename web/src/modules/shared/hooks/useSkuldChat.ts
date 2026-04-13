import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useWebSocket } from '@/hooks/useWebSocket';
import { useChatStore } from '@/modules/shared/store/chat.store';
import { getAccessToken } from '@/modules/shared/api/client';
import type { SlashCommand } from '@/modules/shared/components/SessionChat/slashCommands';
import { buildCommandList } from '@/modules/shared/components/SessionChat/slashCommands';

/**
 * Shape of events from Claude CLI `--output-format stream-json`
 * piped through the Skuld WebSocket pass-through.
 */
interface CliStreamEvent {
  type: string;

  // 'assistant' event — start of assistant turn
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  // 'content_block_start' event
  index?: number;
  content_block?: { type: string; text?: string; id?: string; name?: string };

  // 'content_block_delta' event
  delta?: {
    type?: string;
    text?: string;
    thinking?: string;
    partial_json?: string;
    stop_reason?: string;
  };

  // 'message_delta' event
  usage?: { input_tokens?: number; output_tokens?: number };

  // 'result' event
  subtype?: string;
  cost_usd?: number;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  is_error?: boolean;
  session_id?: string;
  result?: string;

  // Direct content field (some formats include text here)
  content?: string | Array<{ type: string; text?: string }>;

  // System event fields
  hook_name?: string;
  output?: string;
  stdout?: string;
  stderr?: string;
  model?: string;
  tools?: string[];

  // Error events
  error?: string | { message?: string };

  // 'control_request' event (permission flow)
  controlType?: string;
  request_id?: string;
  tool?: string;
  input?: Record<string, unknown>;
}

export interface TransportCapabilities {
  readonly send_message: boolean;
  readonly cli_websocket: boolean;
  readonly session_resume: boolean;
  readonly interrupt: boolean;
  readonly set_model: boolean;
  readonly set_thinking_tokens: boolean;
  readonly set_permission_mode: boolean;
  readonly rewind_files: boolean;
  readonly mcp_set_servers: boolean;
  readonly permission_requests: boolean;
  readonly slash_commands: boolean;
  readonly skills: boolean;
}

export const DEFAULT_CAPABILITIES: TransportCapabilities = {
  send_message: true,
  cli_websocket: false,
  session_resume: false,
  interrupt: false,
  set_model: false,
  set_thinking_tokens: false,
  set_permission_mode: false,
  rewind_files: false,
  mcp_set_servers: false,
  permission_requests: false,
  slash_commands: false,
  skills: false,
};

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type SkuldChatMessagePart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'reasoning'; readonly text: string }
  | {
      readonly type: 'tool_use';
      readonly id: string;
      readonly name: string;
      readonly input: Record<string, unknown>;
    }
  | { readonly type: 'tool_result'; readonly tool_use_id: string; readonly content: string };

// ── Anthropic-format content blocks for the WebSocket protocol ──

export interface TextContentBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ImageContentBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

export interface DocumentContentBlock {
  readonly type: 'document';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
}

export type ContentBlock = TextContentBlock | ImageContentBlock | DocumentContentBlock;

export interface AttachmentMeta {
  readonly name: string;
  readonly type: 'image' | 'document' | 'text';
  readonly size: number;
  readonly contentType: string;
}

export interface ChatMessageMeta {
  messageType?: 'system';
  systemSubtype?: string;
  usage?: Record<
    string,
    {
      inputTokens?: number;
      outputTokens?: number;
      cacheReadInputTokens?: number;
      cacheCreationInputTokens?: number;
      costUSD?: number;
    }
  >;
  cost?: number;
  turns?: number;
}

export interface ParticipantMeta {
  readonly peerId: string;
  readonly persona: string;
  readonly color: string;
  readonly participantType: 'human' | 'ravn';
  readonly gatewayUrl?: string;
}

export interface SkuldChatMessage {
  readonly id: string;
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly parts?: readonly SkuldChatMessagePart[];
  readonly attachments?: readonly AttachmentMeta[];
  readonly createdAt: Date;
  readonly status: 'running' | 'complete' | 'error';
  readonly metadata?: ChatMessageMeta;
  // Multi-participant fields (undefined in single-agent mode)
  readonly participantId?: string;
  readonly participant?: ParticipantMeta;
  readonly threadId?: string;
  readonly visibility?: string;
}

export type PermissionBehavior = 'allow' | 'deny' | 'allowForever';

export interface PermissionRequest {
  readonly request_id: string;
  readonly controlType: string;
  readonly tool: string;
  readonly input: Record<string, unknown>;
  readonly receivedAt: Date;
}

interface UseSkuldChatOptions {
  /** Called when the WebSocket connects */
  onConnect?: () => void;
  /** Called when the WebSocket disconnects */
  onDisconnect?: () => void;
}

interface ConversationTurn {
  id: string;
  role: string;
  content: string;
  parts: Array<Record<string, unknown>>;
  created_at: string;
  metadata: Record<string, unknown>;
  participant_id?: string;
  participant_meta?: Record<string, unknown>;
  thread_id?: string;
  visibility?: string;
}

/**
 * Convert server-side ConversationTurn objects to SkuldChatMessage[].
 */
function transformTurns(turns: ConversationTurn[]): SkuldChatMessage[] {
  return turns.map(turn => ({
    id: turn.id,
    role: (turn.role === 'user' ? 'user' : 'assistant') as ChatMessageRole,
    content: turn.content,
    parts: turn.parts?.length ? (turn.parts as unknown as SkuldChatMessagePart[]) : undefined,
    createdAt: new Date(turn.created_at),
    status: 'complete' as const,
    metadata: turn.metadata as ChatMessageMeta | undefined,
    participantId: turn.participant_id,
    participant: turn.participant_meta
      ? ({
          peerId: String(turn.participant_meta.peer_id ?? ''),
          persona: String(turn.participant_meta.persona ?? ''),
          color: String(turn.participant_meta.color ?? ''),
          participantType: (turn.participant_meta.participant_type ?? 'human') as 'human' | 'ravn',
          gatewayUrl: turn.participant_meta.gateway_url
            ? String(turn.participant_meta.gateway_url)
            : undefined,
        } satisfies ParticipantMeta)
      : undefined,
    threadId: turn.thread_id,
    visibility: turn.visibility,
  }));
}

/**
 * Derive an HTTPS base URL from a WebSocket URL, preserving the path prefix.
 * Strips "/session" or "/api/session" to get the session base path.
 * e.g. "wss://host/s/abc/session"     -> "https://host/s/abc"
 * e.g. "wss://host/s/abc/api/session" -> "https://host/s/abc"  (legacy format)
 * e.g. "wss://host/session"           -> "https://host"
 */
function wsUrlToHttpBase(wsUrl: string): string | null {
  try {
    const parsed = new URL(wsUrl);
    const protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
    const basePath = parsed.pathname.replace(/\/(api\/)?session$/, '');
    return `${protocol}//${parsed.host}${basePath}`;
  } catch {
    return null;
  }
}

interface UseSkuldChatReturn {
  messages: readonly SkuldChatMessage[];
  connected: boolean;
  isRunning: boolean;
  historyLoaded: boolean;
  pendingPermissions: readonly PermissionRequest[];
  availableCommands: readonly SlashCommand[];
  capabilities: TransportCapabilities;
  sendMessage: (
    text: string,
    attachments?: ContentBlock[],
    attachmentMeta?: AttachmentMeta[]
  ) => void;
  respondToPermission: (
    requestId: string,
    behavior: PermissionBehavior,
    updatedInput?: Record<string, unknown>
  ) => void;
  sendInterrupt: () => void;
  sendSetModel: (model: string) => void;
  sendSetMaxThinkingTokens: (tokens: number) => void;
  sendRewindFiles: () => void;
  clearMessages: () => void;
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Manages a Skuld chat session over WebSocket.
 *
 * Parses Claude CLI stream-json events forwarded by the broker:
 *   - `assistant`            → creates a new running assistant message
 *   - `content_block_delta`  → accumulates text deltas into the message
 *   - `message_delta`        → captures final output token count
 *   - `result`               → finalizes with cost / turn metadata
 *   - `error`                → marks message as errored
 *   - everything else        → silently consumed
 */
export function useSkuldChat(
  url: string | null,
  options: UseSkuldChatOptions = {}
): UseSkuldChatReturn {
  const { onConnect, onDisconnect } = options;

  const { getMessages, setMessages: persistMessages, clearSession } = useChatStore();

  const [messages, setMessages] = useState<SkuldChatMessage[]>(() => {
    if (!url) return [];
    return getMessages(url);
  });
  const [connected, setConnected] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [pendingPermissions, setPendingPermissions] = useState<PermissionRequest[]>([]);
  const [availableCommands, setAvailableCommands] = useState<SlashCommand[]>([]);
  const [capabilities, setCapabilities] = useState<TransportCapabilities>(DEFAULT_CAPABILITIES);
  // Track which URL we've loaded history for. When the URL changes,
  // historyLoadedForUrl will no longer match, triggering a re-fetch.
  const [historyLoadedForUrl, setHistoryLoadedForUrl] = useState<string | null>(null);
  const historyLoaded = historyLoadedForUrl === url;

  // Fetch conversation history from server on mount/reconnect
  useEffect(() => {
    if (!url || historyLoaded) return;

    const httpBase = wsUrlToHttpBase(url);
    if (!httpBase) {
      // Cannot derive HTTP URL — schedule fallback to sessionStorage
      const timer = setTimeout(() => {
        const cached = getMessages(url);
        if (cached.length) setMessages(cached);
        setHistoryLoadedForUrl(url);
      }, 0);
      return () => clearTimeout(timer);
    }

    let cancelled = false;

    const headers: Record<string, string> = {};
    const token = getAccessToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const historyUrl = new URL('/api/conversation/history', httpBase);
    fetch(historyUrl.href, { headers })
      .then(res => res.json())
      .then(data => {
        if (cancelled) return;
        const serverMsgs = data.turns?.length ? transformTurns(data.turns) : [];
        const isActive = data.is_active === true;
        const lastActivity = data.last_activity ?? '';
        setMessages(prev => {
          // Server history is authoritative. Only keep local messages
          // that were added AFTER the last server message (i.e. messages
          // the user typed that haven't been recorded server-side yet).
          const lastServerTime =
            serverMsgs.length > 0 ? serverMsgs[serverMsgs.length - 1].createdAt.getTime() : 0;
          const localOnly = prev.filter(
            m => m.role === 'user' && m.createdAt.getTime() > lastServerTime
          );
          const merged = [...serverMsgs, ...localOnly];
          // If session is actively working, add a placeholder running message
          if (isActive && lastActivity) {
            merged.push({
              id: 'activity-indicator',
              role: 'assistant',
              content: lastActivity,
              createdAt: new Date(),
              status: 'running',
            });
          }
          return merged;
        });
        if (isActive) setIsRunning(true);
        setHistoryLoadedForUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        // Fallback to sessionStorage cache
        const cached = getMessages(url);
        if (cached.length) setMessages(cached);
        setHistoryLoadedForUrl(url);
      });

    return () => {
      cancelled = true;
    };
  }, [url, historyLoaded, getMessages]);

  // Persist messages to Zustand sessionStorage store on every change
  useEffect(() => {
    if (!url) return;
    persistMessages(url, messages);
  }, [url, messages, persistMessages]);

  // Streaming state refs (not in React state to avoid render churn)
  const streamingIdRef = useRef<string | null>(null);
  const streamingTextRef = useRef('');
  const streamingModelRef = useRef('');
  const streamingInputTokensRef = useRef(0);
  const streamingOutputTokensRef = useRef(0);
  const streamingPartsRef = useRef<SkuldChatMessagePart[]>([]);
  const streamingToolJsonRef = useRef('');
  const streamingToolNameRef = useRef('');
  const streamingToolIdRef = useRef('');

  const resetStreamingRefs = useCallback(() => {
    streamingIdRef.current = null;
    streamingTextRef.current = '';
    streamingModelRef.current = '';
    streamingInputTokensRef.current = 0;
    streamingOutputTokensRef.current = 0;
    streamingPartsRef.current = [];
    streamingToolJsonRef.current = '';
    streamingToolNameRef.current = '';
    streamingToolIdRef.current = '';
  }, []);

  const handleOpen = useCallback(() => {
    setConnected(true);
    onConnect?.();
  }, [onConnect]);

  /**
   * Parse a single raw line into a CliStreamEvent, stripping SSE prefix if present.
   */
  const parseEvent = useCallback((raw: string): CliStreamEvent | null => {
    let jsonStr = raw.trim();
    if (jsonStr.startsWith('data:')) {
      jsonStr = jsonStr.slice(5).trim();
    }
    try {
      return JSON.parse(jsonStr) as CliStreamEvent;
    } catch (err) {
      console.warn('[skuld-ws] JSON parse failed:', err, 'raw:', raw.slice(0, 200));
      return null;
    }
  }, []);

  const handleMessage = useCallback(
    (raw: string) => {
      // Handle potential multi-line JSON (NDJSON) where multiple
      // events arrive in a single WebSocket frame.
      const lines = raw.split('\n').filter(l => l.trim());
      const events: CliStreamEvent[] = [];
      for (const line of lines) {
        const evt = parseEvent(line);
        if (evt) events.push(evt);
      }

      if (events.length === 0) {
        return;
      }

      for (const event of events) {
        const eventType = event.type;

        // ── assistant: start of a new assistant turn ──────────────
        if (eventType === 'assistant') {
          // Finalize any previous in-flight message before starting a new one
          if (streamingIdRef.current) {
            const prevId = streamingIdRef.current;
            const prevText = streamingTextRef.current;
            const prevParts =
              streamingPartsRef.current.length > 0 ? [...streamingPartsRef.current] : undefined;
            const prevModel = streamingModelRef.current;
            const prevMeta: ChatMessageMeta = {
              usage: prevModel
                ? {
                    [prevModel]: {
                      inputTokens: streamingInputTokensRef.current,
                      outputTokens: streamingOutputTokensRef.current,
                    },
                  }
                : undefined,
            };
            if (prevText.trim()) {
              // Has content — finalize as complete message
              setMessages(prev =>
                prev.map(m =>
                  m.id === prevId
                    ? {
                        ...m,
                        content: prevText,
                        parts: prevParts,
                        status: 'complete' as const,
                        metadata: prevMeta,
                      }
                    : m
                )
              );
            } else {
              // Empty content (only thinking/tool calls) — remove to avoid clutter
              setMessages(prev => prev.filter(m => m.id !== prevId));
            }
            resetStreamingRefs();
          }

          // Extract any initial text content from the assistant event's message
          const initialContent =
            event.message?.content
              ?.filter(c => c.type === 'text' && c.text)
              .map(c => c.text)
              .join('') ?? '';

          streamingTextRef.current = initialContent;
          streamingModelRef.current = event.message?.model ?? '';
          streamingInputTokensRef.current = event.message?.usage?.input_tokens ?? 0;
          streamingOutputTokensRef.current = event.message?.usage?.output_tokens ?? 0;

          const id = generateId();
          streamingIdRef.current = id;
          setIsRunning(true);
          setMessages(prev => [
            // Remove any activity indicator placeholder
            ...prev.filter(m => m.id !== 'activity-indicator'),
            {
              id,
              role: 'assistant',
              content: initialContent,
              createdAt: new Date(),
              status: 'running',
            },
          ]);
          continue;
        }

        // ── content_block_start: track new content block type ────
        if (eventType === 'content_block_start') {
          const blockType = event.content_block?.type;
          if (blockType === 'thinking') {
            // Always ensure there's a reasoning part at the end for deltas to append to.
            // If the last part is already reasoning, reuse it (groups consecutive thinking).
            const parts = streamingPartsRef.current;
            const last = parts[parts.length - 1];
            if (!last || last.type !== 'reasoning') {
              streamingPartsRef.current = [...parts, { type: 'reasoning', text: '' }];
            }
          } else if (blockType === 'text') {
            streamingPartsRef.current = [...streamingPartsRef.current, { type: 'text', text: '' }];
          } else if (blockType === 'tool_use') {
            const toolId = event.content_block?.id ?? '';
            const toolName = event.content_block?.name ?? '';
            streamingToolIdRef.current = toolId;
            streamingToolNameRef.current = toolName;
            streamingToolJsonRef.current = '';
            streamingPartsRef.current = [
              ...streamingPartsRef.current,
              { type: 'tool_use', id: toolId, name: toolName, input: {} },
            ];
            // Update message immediately to show the tool block
            if (streamingIdRef.current) {
              const id = streamingIdRef.current;
              const currentParts = [...streamingPartsRef.current];
              setMessages(prev => prev.map(m => (m.id === id ? { ...m, parts: currentParts } : m)));
            }
          }
          continue;
        }

        // ── content_block_delta: accumulate text/thinking/tool chunks ──
        if (eventType === 'content_block_delta') {
          const delta = event.delta;

          // Handle tool input JSON deltas
          if (delta?.type === 'input_json_delta' && delta.partial_json) {
            streamingToolJsonRef.current += delta.partial_json;
            continue;
          }

          // Handle thinking deltas (reasoning content)
          if (delta?.type === 'thinking_delta' && delta.thinking) {
            const parts = streamingPartsRef.current;
            const lastIdx = parts.length - 1;
            if (lastIdx >= 0 && parts[lastIdx].type === 'reasoning') {
              const updated = [...parts];
              updated[lastIdx] = {
                ...parts[lastIdx],
                text: parts[lastIdx].text + delta.thinking,
              };
              streamingPartsRef.current = updated;
            }
            if (streamingIdRef.current) {
              const id = streamingIdRef.current;
              const currentParts = [...streamingPartsRef.current];
              setMessages(prev => prev.map(m => (m.id === id ? { ...m, parts: currentParts } : m)));
            }
            continue;
          }

          // Accept both 'text_delta' type and direct text on delta
          const textChunk =
            delta?.type === 'text_delta' && delta.text ? delta.text : (delta?.text ?? null);

          if (textChunk) {
            streamingTextRef.current += textChunk;

            // Also update the structured parts array
            const parts = streamingPartsRef.current;
            const lastIdx = parts.length - 1;
            if (lastIdx >= 0 && parts[lastIdx].type === 'text') {
              const updated = [...parts];
              updated[lastIdx] = {
                ...parts[lastIdx],
                text: parts[lastIdx].text + textChunk,
              };
              streamingPartsRef.current = updated;
            } else {
              // No text part started yet (no content_block_start received)
              streamingPartsRef.current = [...parts, { type: 'text', text: textChunk }];
            }

            if (streamingIdRef.current) {
              const id = streamingIdRef.current;
              const text = streamingTextRef.current;
              const currentParts = [...streamingPartsRef.current];
              setMessages(prev =>
                prev.map(m => (m.id === id ? { ...m, content: text, parts: currentParts } : m))
              );
            }
          }
          continue;
        }

        // ── message_delta: capture final output token count ──────
        if (eventType === 'message_delta') {
          if (event.usage?.output_tokens) {
            streamingOutputTokensRef.current = event.usage.output_tokens;
          }
          continue;
        }

        // ── result: finalize message with metadata ───────────────
        if (eventType === 'result') {
          // Try to extract text from the result event itself as a fallback
          let resultText = '';
          if (typeof event.result === 'string') {
            resultText = event.result;
          } else if (typeof event.content === 'string') {
            resultText = event.content;
          } else if (Array.isArray(event.content)) {
            resultText = event.content
              .filter(c => c.type === 'text' && c.text)
              .map(c => c.text)
              .join('');
          }

          const finalContent = streamingTextRef.current || resultText;
          const finalParts =
            streamingPartsRef.current.length > 0 ? [...streamingPartsRef.current] : undefined;
          const model = streamingModelRef.current;

          const meta: ChatMessageMeta = {
            usage: model
              ? {
                  [model]: {
                    inputTokens: streamingInputTokensRef.current,
                    outputTokens: streamingOutputTokensRef.current,
                  },
                }
              : undefined,
            cost: event.total_cost_usd,
            turns: event.num_turns,
          };

          if (event.is_error) {
            // Error result — mark message as errored
            if (streamingIdRef.current) {
              const id = streamingIdRef.current;
              const errorContent = finalContent || 'An error occurred';
              setMessages(prev =>
                prev.map(m =>
                  m.id === id
                    ? {
                        ...m,
                        content: errorContent,
                        parts: finalParts,
                        status: 'error' as const,
                        metadata: meta,
                      }
                    : m
                )
              );
            } else {
              setMessages(prev => [
                ...prev,
                {
                  id: generateId(),
                  role: 'assistant',
                  content: finalContent || 'An error occurred',
                  parts: finalParts,
                  createdAt: new Date(),
                  status: 'error',
                  metadata: meta,
                },
              ]);
            }
          } else if (streamingIdRef.current) {
            // Success — finalize existing streaming message
            const id = streamingIdRef.current;
            setMessages(prev =>
              prev.map(m =>
                m.id === id
                  ? {
                      ...m,
                      content: finalContent,
                      parts: finalParts,
                      status: 'complete' as const,
                      metadata: meta,
                    }
                  : m
              )
            );
          } else if (finalContent) {
            // Result arrived without prior assistant event — create message
            setMessages(prev => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: finalContent,
                parts: finalParts,
                createdAt: new Date(),
                status: 'complete',
                metadata: meta,
              },
            ]);
          }

          resetStreamingRefs();
          setIsRunning(false);
          continue;
        }

        // ── error: show as errored assistant message ─────────────
        if (eventType === 'error') {
          const errorMsg =
            typeof event.error === 'string'
              ? event.error
              : typeof event.error === 'object' && event.error?.message
                ? event.error.message
                : 'Unknown error';

          if (streamingIdRef.current) {
            const id = streamingIdRef.current;
            setMessages(prev =>
              prev.map(m =>
                m.id === id ? { ...m, content: errorMsg, status: 'error' as const } : m
              )
            );
          } else {
            setMessages(prev => [
              ...prev,
              {
                id: generateId(),
                role: 'assistant',
                content: errorMsg,
                createdAt: new Date(),
                status: 'error',
              },
            ]);
          }
          resetStreamingRefs();
          setIsRunning(false);
          continue;
        }

        // ── available_commands: update slash commands from CLI ──
        if (eventType === 'available_commands') {
          const cmds = buildCommandList(
            (event as unknown as { slash_commands?: string[] }).slash_commands ?? [],
            (event as unknown as { skills?: string[] }).skills ?? []
          );
          setAvailableCommands(cmds);
          continue;
        }

        // ── capabilities: update transport capabilities ──
        if (eventType === 'capabilities') {
          const caps = event as unknown as Record<string, unknown>;
          setCapabilities({
            send_message: caps.send_message !== false,
            cli_websocket: caps.cli_websocket === true,
            session_resume: caps.session_resume === true,
            interrupt: caps.interrupt === true,
            set_model: caps.set_model === true,
            set_thinking_tokens: caps.set_thinking_tokens === true,
            set_permission_mode: caps.set_permission_mode === true,
            rewind_files: caps.rewind_files === true,
            mcp_set_servers: caps.mcp_set_servers === true,
            permission_requests: caps.permission_requests === true,
            slash_commands: caps.slash_commands === true,
            skills: caps.skills === true,
          });
          continue;
        }

        // ── user_confirmed: broker echo confirming message reached session ──
        if (eventType === 'user_confirmed') {
          // The broker confirmed the message was sent to the CLI.
          // No UI update needed here — the user message was already added
          // optimistically by sendMessage(). This event serves as
          // confirmation for debugging and future delivery status.
          continue;
        }

        // ── control_request: queue permission request for the UI ──
        if (eventType === 'control_request') {
          const requestId = event.request_id;
          if (requestId) {
            setPendingPermissions(prev => [
              ...prev,
              {
                request_id: requestId,
                controlType: event.controlType ?? 'can_use_tool',
                tool: event.tool ?? 'unknown',
                input: event.input ?? {},
                receivedAt: new Date(),
              },
            ]);
          }
          continue;
        }

        // ── system: show lifecycle events as system messages ──────
        if (eventType === 'system') {
          const subtype = event.subtype ?? '';
          let content = '';

          if (subtype === 'hook_started') {
            content = `Hook started: ${event.hook_name ?? 'unknown'}`;
          } else if (subtype === 'hook_response') {
            const output = (typeof event.output === 'string' ? event.output : '').trim();
            const stderr = (typeof event.stderr === 'string' ? event.stderr : '').trim();
            const firstLine = output.split('\n')[0].slice(0, 120);
            content = `Hook ${event.hook_name ?? ''}: ${firstLine}${stderr ? ' (errors)' : ''}`;
          } else if (subtype === 'init') {
            const model = typeof event.model === 'string' ? event.model : 'unknown';
            const toolCount = Array.isArray(event.tools) ? event.tools.length : 0;
            content = `Session initialized · ${model} · ${toolCount} tools`;
          } else {
            const raw = typeof event.content === 'string' ? event.content : '';
            content = raw || 'System event';
          }

          setMessages(prev => [
            ...prev,
            {
              id: generateId(),
              role: 'assistant',
              content,
              createdAt: new Date(),
              status: 'complete',
              metadata: { messageType: 'system', systemSubtype: subtype || 'info' },
            },
          ]);
          continue;
        }

        // ── content_block_stop: finalize tool_use input JSON ──────
        if (eventType === 'content_block_stop') {
          if (streamingToolIdRef.current && streamingToolJsonRef.current) {
            try {
              const input = JSON.parse(streamingToolJsonRef.current) as Record<string, unknown>;
              const parts = streamingPartsRef.current;
              let toolIdx = -1;
              for (let i = parts.length - 1; i >= 0; i--) {
                const p = parts[i];
                if (p.type === 'tool_use' && p.id === streamingToolIdRef.current) {
                  toolIdx = i;
                  break;
                }
              }
              if (toolIdx >= 0) {
                const updated = [...parts];
                const existing = parts[toolIdx] as {
                  type: 'tool_use';
                  id: string;
                  name: string;
                  input: Record<string, unknown>;
                };
                updated[toolIdx] = { ...existing, input };
                streamingPartsRef.current = updated;
                if (streamingIdRef.current) {
                  const id = streamingIdRef.current;
                  const currentParts = [...streamingPartsRef.current];
                  setMessages(prev =>
                    prev.map(m => (m.id === id ? { ...m, parts: currentParts } : m))
                  );
                }
              }
            } catch {
              // JSON parse failed — keep empty input
            }
            streamingToolIdRef.current = '';
            streamingToolNameRef.current = '';
            streamingToolJsonRef.current = '';
          }
          continue;
        }

        // ── message_start, message_stop — silently consumed ──────
      } // end for (const event of events)
    },
    [parseEvent, resetStreamingRefs]
  );

  const handleClose = useCallback(() => {
    // Finalize any in-flight streaming message
    if (streamingIdRef.current) {
      const id = streamingIdRef.current;
      const text = streamingTextRef.current;
      const parts =
        streamingPartsRef.current.length > 0 ? [...streamingPartsRef.current] : undefined;
      setMessages(prev =>
        prev.map(m =>
          m.id === id ? { ...m, content: text, parts, status: 'complete' as const } : m
        )
      );
    }
    setConnected(false);
    setIsRunning(false);
    resetStreamingRefs();
    onDisconnect?.();
  }, [onDisconnect, resetStreamingRefs]);

  const handleError = useCallback(() => {
    // Finalize any in-flight streaming message
    if (streamingIdRef.current) {
      const id = streamingIdRef.current;
      const text = streamingTextRef.current;
      const parts =
        streamingPartsRef.current.length > 0 ? [...streamingPartsRef.current] : undefined;
      setMessages(prev =>
        prev.map(m =>
          m.id === id ? { ...m, content: text, parts, status: 'complete' as const } : m
        )
      );
    }
    setConnected(false);
    setIsRunning(false);
    resetStreamingRefs();
  }, [resetStreamingRefs]);

  const { sendJson } = useWebSocket(url, {
    onOpen: handleOpen,
    onMessage: handleMessage,
    onClose: handleClose,
    onError: handleError,
  });

  const sendMessage = useCallback(
    (text: string, attachments?: ContentBlock[], attachmentMeta?: AttachmentMeta[]) => {
      const trimmed = text.trim();
      const hasAttachments = attachments && attachments.length > 0;
      if ((!trimmed && !hasAttachments) || !connected) {
        return;
      }

      setMessages(prev => [
        ...prev,
        {
          id: generateId(),
          role: 'user',
          content: trimmed,
          attachments: attachmentMeta,
          createdAt: new Date(),
          status: 'complete',
        },
      ]);

      if (hasAttachments) {
        const contentBlocks: ContentBlock[] = [];
        if (trimmed) {
          contentBlocks.push({ type: 'text', text: trimmed });
        }
        contentBlocks.push(...attachments);
        sendJson({ type: 'user', content: contentBlocks });
      } else {
        sendJson({ type: 'user', content: trimmed });
      }
      setIsRunning(true);
    },
    [connected, sendJson]
  );

  const respondToPermission = useCallback(
    (requestId: string, behavior: PermissionBehavior, updatedInput?: Record<string, unknown>) => {
      sendJson({
        type: 'permission_response',
        request_id: requestId,
        behavior,
        updated_input: updatedInput ?? {},
        updated_permissions: [],
      });
      setPendingPermissions(prev => prev.filter(p => p.request_id !== requestId));
    },
    [sendJson]
  );

  const sendInterrupt = useCallback(() => {
    sendJson({ type: 'interrupt' });
  }, [sendJson]);

  const sendSetModel = useCallback(
    (model: string) => {
      sendJson({ type: 'set_model', model });
    },
    [sendJson]
  );

  const sendSetMaxThinkingTokens = useCallback(
    (maxThinkingTokens: number) => {
      sendJson({ type: 'set_max_thinking_tokens', max_thinking_tokens: maxThinkingTokens });
    },
    [sendJson]
  );

  const sendRewindFiles = useCallback(() => {
    sendJson({ type: 'rewind_files' });
  }, [sendJson]);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setPendingPermissions([]);
    resetStreamingRefs();
    setIsRunning(false);
    if (url) clearSession(url);
  }, [resetStreamingRefs, url, clearSession]);

  const stableMessages = useMemo(() => messages, [messages]);
  const stablePermissions = useMemo(() => pendingPermissions, [pendingPermissions]);
  const stableCommands = useMemo(() => availableCommands, [availableCommands]);
  const stableCapabilities = useMemo(() => capabilities, [capabilities]);

  return {
    messages: stableMessages,
    connected,
    isRunning,
    historyLoaded,
    pendingPermissions: stablePermissions,
    availableCommands: stableCommands,
    capabilities: stableCapabilities,
    sendMessage,
    respondToPermission,
    sendInterrupt,
    sendSetModel,
    sendSetMaxThinkingTokens,
    sendRewindFiles,
    clearMessages,
  };
}
