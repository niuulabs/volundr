/**
 * Type declarations for @codingame/monaco-vscode-api packages.
 *
 * These are minimal declarations sufficient for the EditorPanel component.
 * When the actual packages are installed (npm install), these declarations
 * will be superseded by the packages' own type definitions.
 */

declare module '@codingame/monaco-vscode-api' {
  interface IDisposable {
    dispose(): void;
  }

  /** VS Code Event<T> — registers a listener, returns a disposable to unregister. */
  type Event<T> = (listener: (e: T) => void) => IDisposable;

  export interface IWebSocketCloseEvent {
    readonly code: number;
    readonly reason: string;
    readonly wasClean: boolean;
    readonly event: unknown | undefined;
  }

  export interface IWebSocket {
    readonly onData: Event<ArrayBuffer>;
    readonly onOpen: Event<void>;
    readonly onClose: Event<IWebSocketCloseEvent | void>;
    readonly onError: Event<unknown>;
    send(data: ArrayBuffer | ArrayBufferView): void;
    close(): void;
  }

  export interface IWebSocketFactory {
    create(url: string, debugLabel?: string): IWebSocket;
  }

  export interface WorkbenchOptions {
    remoteAuthority?: string;
    enableWorkspaceTrust?: boolean;
    webSocketFactory?: IWebSocketFactory;
    workspaceProvider?: {
      trusted?: boolean;
      workspace: { folderUri: unknown } | { workspaceUri: unknown } | undefined;
      open: () => Promise<boolean>;
    };
    initialColorTheme?: {
      themeType: string;
      colors?: Record<string, string>;
    };
    configurationDefaults?: Record<string, unknown>;
    productConfiguration?: {
      nameShort?: string;
      nameLong?: string;
      extensionsGallery?: Record<string, string>;
    };
  }

  export type ServiceOverrides = Record<string, unknown>;

  export function initialize(
    serviceOverrides: ServiceOverrides,
    container: HTMLElement,
    options?: WorkbenchOptions,
    envOptions?: Record<string, unknown>
  ): Promise<void>;
}

declare module '@codingame/monaco-vscode-workbench-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getWorkbenchServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-remote-agent-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getRemoteAgentServiceOverride(options?: {
    scanRemoteExtensions?: boolean;
  }): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-terminal-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getTerminalServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-configuration-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
  export function initUserConfiguration(configuration: string): Promise<void>;
}

declare module '@codingame/monaco-vscode-files-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
  export function createIndexedDBProviders(): Promise<unknown>;
}

declare module '@codingame/monaco-vscode-lifecycle-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-storage-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getStorageServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-environment-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-extensions-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(options?: {
    enableWorkerExtensionHost?: boolean;
  }): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-theme-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-theme-defaults-default-extension' {}
declare module '@codingame/monaco-vscode-theme-seti-default-extension' {}
declare module '@codingame/monaco-vscode-javascript-default-extension' {}
declare module '@codingame/monaco-vscode-typescript-basics-default-extension' {}
declare module '@codingame/monaco-vscode-json-default-extension' {}
declare module '@codingame/monaco-vscode-html-default-extension' {}
declare module '@codingame/monaco-vscode-css-default-extension' {}
declare module '@codingame/monaco-vscode-markdown-basics-default-extension' {}
declare module '@codingame/monaco-vscode-python-default-extension' {}
declare module '@codingame/monaco-vscode-shellscript-default-extension' {}
declare module '@codingame/monaco-vscode-yaml-default-extension' {}
declare module '@codingame/monaco-vscode-xml-default-extension' {}
declare module '@codingame/monaco-vscode-docker-default-extension' {}
declare module '@codingame/monaco-vscode-go-default-extension' {}
declare module '@codingame/monaco-vscode-rust-default-extension' {}
declare module '@codingame/monaco-vscode-cpp-default-extension' {}
declare module '@codingame/monaco-vscode-java-default-extension' {}
declare module '@codingame/monaco-vscode-sql-default-extension' {}
declare module '@codingame/monaco-vscode-dotenv-default-extension' {}
declare module '@codingame/monaco-vscode-ini-default-extension' {}
declare module '@codingame/monaco-vscode-make-default-extension' {}
declare module '@codingame/monaco-vscode-diff-default-extension' {}
declare module '@codingame/monaco-vscode-log-default-extension' {}
declare module '@codingame/monaco-vscode-configuration-editing-default-extension' {}
declare module '@codingame/monaco-vscode-search-result-default-extension' {}
declare module '@codingame/monaco-vscode-scss-default-extension' {}
declare module '@codingame/monaco-vscode-less-default-extension' {}
declare module '@codingame/monaco-vscode-lua-default-extension' {}
declare module '@codingame/monaco-vscode-ruby-default-extension' {}
declare module '@codingame/monaco-vscode-php-default-extension' {}
declare module '@codingame/monaco-vscode-csharp-default-extension' {}
declare module '@codingame/monaco-vscode-swift-default-extension' {}
declare module '@codingame/monaco-vscode-perl-default-extension' {}
declare module '@codingame/monaco-vscode-r-default-extension' {}
declare module '@codingame/monaco-vscode-git-base-default-extension' {}
declare module '@codingame/monaco-vscode-merge-conflict-default-extension' {}
declare module '@codingame/monaco-vscode-references-view-default-extension' {}

declare module '@codingame/monaco-vscode-dialogs-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-keybindings-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
  export function initUserKeybindings(keybindings: string): Promise<void>;
}

declare module '@codingame/monaco-vscode-languages-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-textmate-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-textmate-service-override/worker' {
  // Worker entry point
}

declare module '@codingame/monaco-vscode-search-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-search-service-override/worker' {}

declare module '@codingame/monaco-vscode-output-service-override/worker' {}

declare module '@codingame/monaco-vscode-markers-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-editor-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-views-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-snippets-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-quickaccess-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(options?: {
    isKeybindingConfigurationVisible?: () => boolean;
    shouldUseGlobalPicker?: () => boolean;
  }): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-output-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-notifications-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-language-detection-worker-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-language-detection-worker-service-override/worker' {
  // Worker entry point
}

declare module '@codingame/monaco-vscode-accessibility-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-debug-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-preferences-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-scm-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-notebook-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-explorer-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-model-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-working-copy-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-workspace-trust-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-log-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-layout-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(container?: HTMLElement): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-host-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-base-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-bulk-edit-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-view-common-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-view-banner-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-view-status-bar-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-view-title-bar-service-override' {
  import type { ServiceOverrides } from '@codingame/monaco-vscode-api';
  export default function getServiceOverride(): ServiceOverrides;
}

declare module '@codingame/monaco-vscode-api/workers/editor.worker' {
  // Worker entry point
}

declare module '@codingame/monaco-vscode-api/workers/extensionHost.worker' {
  // Extension host worker entry point
}

declare module '@codingame/monaco-vscode-api/vscode/vs/base/common/uri' {
  export class URI {
    static from(components: {
      scheme: string;
      authority?: string;
      path?: string;
      query?: string;
      fragment?: string;
    }): URI;
    static parse(value: string): URI;
    readonly scheme: string;
    readonly authority: string;
    readonly path: string;
  }
}
