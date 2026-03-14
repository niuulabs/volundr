/**
 * Type declarations for @codingame/monaco-vscode-api packages.
 *
 * These are minimal declarations sufficient for the EditorPanel component.
 * When the actual packages are installed (npm install), these declarations
 * will be superseded by the packages' own type definitions.
 */

declare module '@codingame/monaco-vscode-api' {
  export interface IWebSocket {
    send(data: ArrayBuffer | string): void;
    close(): void;
    onOpen(listener: () => void): void;
    onClose(listener: (code: number, reason: string) => void): void;
    onMessage(listener: (data: ArrayBuffer | string) => void): void;
    onError(listener: (error: unknown) => void): void;
    getProtocol(): string;
  }

  export interface IWebSocketFactory {
    create(url: string): IWebSocket;
  }

  export interface WorkbenchOptions {
    remoteAuthority?: string;
    webSocketFactory?: IWebSocketFactory;
  }

  export type ServiceOverrides = Record<string, unknown>;

  export function initialize(
    serviceOverrides: ServiceOverrides,
    container: HTMLElement,
    options?: WorkbenchOptions
  ): Promise<void>;
}

declare module '@codingame/monaco-vscode-workbench-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getWorkbenchServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-remote-agent-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getRemoteAgentServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-terminal-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getTerminalServiceOverride(): ServiceOverrides;
}
