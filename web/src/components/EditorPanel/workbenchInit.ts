/**
 * VS Code workbench initialization — mirrors the official CodinGame demo.
 *
 * This module handles all the setup that must happen BEFORE and DURING
 * the `initialize()` call from @codingame/monaco-vscode-api.
 *
 * Uses STATIC imports (matching the demo) so Vite can properly pre-bundle
 * all service override packages. Dynamic imports caused module resolution
 * issues that prevented views from registering.
 *
 * The workbench is initialized ONCE with a stable remote authority and a
 * dynamic WebSocket factory. Session switching is handled by updating the
 * mutable routing state and forcing a reconnection — no page reload needed.
 *
 * @see https://github.com/CodinGame/monaco-vscode-api/tree/main/demo
 */
import { getAccessToken } from '@/adapters/api/client';
import { ApiEditorAdapter } from '@/adapters/api/editor.adapter';
import { isInitialized, markInitialized } from './editorState';
import {
  getActiveRoute,
  setActiveRoute,
  trackWebSocket,
  closeAllWebSockets,
} from './sessionRouter';
import { saveTabState, restoreTabState } from './tabStateManager';

// ── Static imports (matching demo pattern) ──
import { initialize } from '@codingame/monaco-vscode-api';
import { registerExtension, ExtensionHostKind } from '@codingame/monaco-vscode-api/extensions';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { createIndexedDBProviders } from '@codingame/monaco-vscode-files-service-override';
import { initUserConfiguration } from '@codingame/monaco-vscode-configuration-service-override';
import { initUserKeybindings } from '@codingame/monaco-vscode-keybindings-service-override';

// ── Service override imports (static, matching demo) ──
import getWorkbenchServiceOverride from '@codingame/monaco-vscode-workbench-service-override';
import getRemoteAgentServiceOverride from '@codingame/monaco-vscode-remote-agent-service-override';
import getTerminalServiceOverride from '@codingame/monaco-vscode-terminal-service-override';
import getConfigurationServiceOverride from '@codingame/monaco-vscode-configuration-service-override';
import getKeybindingsServiceOverride from '@codingame/monaco-vscode-keybindings-service-override';
import getLifecycleServiceOverride from '@codingame/monaco-vscode-lifecycle-service-override';
import getStorageServiceOverride from '@codingame/monaco-vscode-storage-service-override';
import getEnvironmentServiceOverride from '@codingame/monaco-vscode-environment-service-override';
import getExtensionsServiceOverride from '@codingame/monaco-vscode-extensions-service-override';
import getExtensionGalleryServiceOverride from '@codingame/monaco-vscode-extension-gallery-service-override';
import getThemeServiceOverride from '@codingame/monaco-vscode-theme-service-override';
import getDialogsServiceOverride from '@codingame/monaco-vscode-dialogs-service-override';
import getLanguagesServiceOverride from '@codingame/monaco-vscode-languages-service-override';
import getTextmateServiceOverride from '@codingame/monaco-vscode-textmate-service-override';
import getSearchServiceOverride from '@codingame/monaco-vscode-search-service-override';
import getMarkersServiceOverride from '@codingame/monaco-vscode-markers-service-override';
import getModelServiceOverride from '@codingame/monaco-vscode-model-service-override';
import getSnippetsServiceOverride from '@codingame/monaco-vscode-snippets-service-override';
import getQuickaccessServiceOverride from '@codingame/monaco-vscode-quickaccess-service-override';
import getOutputServiceOverride from '@codingame/monaco-vscode-output-service-override';
import getNotificationsServiceOverride from '@codingame/monaco-vscode-notifications-service-override';
import getLanguageDetectionWorkerServiceOverride from '@codingame/monaco-vscode-language-detection-worker-service-override';
import getAccessibilityServiceOverride from '@codingame/monaco-vscode-accessibility-service-override';
import getDebugServiceOverride from '@codingame/monaco-vscode-debug-service-override';
import getPreferencesServiceOverride from '@codingame/monaco-vscode-preferences-service-override';
import getScmServiceOverride from '@codingame/monaco-vscode-scm-service-override';
import getExplorerServiceOverride from '@codingame/monaco-vscode-explorer-service-override';
import getWorkingCopyServiceOverride from '@codingame/monaco-vscode-working-copy-service-override';
import getWorkspaceTrustServiceOverride from '@codingame/monaco-vscode-workspace-trust-service-override';
import getLogServiceOverride from '@codingame/monaco-vscode-log-service-override';
import getBannerServiceOverride from '@codingame/monaco-vscode-view-banner-service-override';
import getStatusBarServiceOverride from '@codingame/monaco-vscode-view-status-bar-service-override';
import getTitleBarServiceOverride from '@codingame/monaco-vscode-view-title-bar-service-override';
import getSecretStorageServiceOverride from '@codingame/monaco-vscode-secret-storage-service-override';
import getAuthenticationServiceOverride from '@codingame/monaco-vscode-authentication-service-override';
import getOutlineServiceOverride from '@codingame/monaco-vscode-outline-service-override';
import getTimelineServiceOverride from '@codingame/monaco-vscode-timeline-service-override';
import getTestingServiceOverride from '@codingame/monaco-vscode-testing-service-override';
import getTaskServiceOverride from '@codingame/monaco-vscode-task-service-override';
import getLocalizationServiceOverride from '@codingame/monaco-vscode-localization-service-override';
import getUserDataProfileServiceOverride from '@codingame/monaco-vscode-user-data-profile-service-override';
import getUserDataSyncServiceOverride from '@codingame/monaco-vscode-user-data-sync-service-override';
import getUpdateServiceOverride from '@codingame/monaco-vscode-update-service-override';
import getWelcomeServiceOverride from '@codingame/monaco-vscode-welcome-service-override';
import getEmmetServiceOverride from '@codingame/monaco-vscode-emmet-service-override';
import getMultiDiffEditorServiceOverride from '@codingame/monaco-vscode-multi-diff-editor-service-override';
import getCommentsServiceOverride from '@codingame/monaco-vscode-comments-service-override';
import getEditSessionsServiceOverride from '@codingame/monaco-vscode-edit-sessions-service-override';
import getInteractiveServiceOverride from '@codingame/monaco-vscode-interactive-service-override';
import getIssueServiceOverride from '@codingame/monaco-vscode-issue-service-override';
import getPerformanceServiceOverride from '@codingame/monaco-vscode-performance-service-override';
import getRelauncherServiceOverride from '@codingame/monaco-vscode-relauncher-service-override';
import getShareServiceOverride from '@codingame/monaco-vscode-share-service-override';
import getSpeechServiceOverride from '@codingame/monaco-vscode-speech-service-override';
import getSurveyServiceOverride from '@codingame/monaco-vscode-survey-service-override';

// ── Default extensions — side-effect imports for grammars, themes, icons ──
import '@codingame/monaco-vscode-theme-defaults-default-extension';
import '@codingame/monaco-vscode-theme-seti-default-extension';
import '@codingame/monaco-vscode-javascript-default-extension';
import '@codingame/monaco-vscode-typescript-basics-default-extension';
import '@codingame/monaco-vscode-json-default-extension';
import '@codingame/monaco-vscode-html-default-extension';
import '@codingame/monaco-vscode-css-default-extension';
import '@codingame/monaco-vscode-markdown-basics-default-extension';
import '@codingame/monaco-vscode-python-default-extension';
import '@codingame/monaco-vscode-shellscript-default-extension';
import '@codingame/monaco-vscode-yaml-default-extension';
import '@codingame/monaco-vscode-xml-default-extension';
import '@codingame/monaco-vscode-docker-default-extension';
import '@codingame/monaco-vscode-go-default-extension';
import '@codingame/monaco-vscode-rust-default-extension';
import '@codingame/monaco-vscode-cpp-default-extension';
import '@codingame/monaco-vscode-java-default-extension';
import '@codingame/monaco-vscode-sql-default-extension';
import '@codingame/monaco-vscode-dotenv-default-extension';
import '@codingame/monaco-vscode-ini-default-extension';
import '@codingame/monaco-vscode-make-default-extension';
import '@codingame/monaco-vscode-diff-default-extension';
import '@codingame/monaco-vscode-log-default-extension';
import '@codingame/monaco-vscode-configuration-editing-default-extension';
import '@codingame/monaco-vscode-search-result-default-extension';
import '@codingame/monaco-vscode-scss-default-extension';
import '@codingame/monaco-vscode-less-default-extension';
import '@codingame/monaco-vscode-lua-default-extension';
import '@codingame/monaco-vscode-ruby-default-extension';
import '@codingame/monaco-vscode-php-default-extension';
import '@codingame/monaco-vscode-csharp-default-extension';
import '@codingame/monaco-vscode-swift-default-extension';
import '@codingame/monaco-vscode-perl-default-extension';
import '@codingame/monaco-vscode-r-default-extension';
import '@codingame/monaco-vscode-git-base-default-extension';
import '@codingame/monaco-vscode-merge-conflict-default-extension';
import '@codingame/monaco-vscode-references-view-default-extension';

// ── Local extension host (side-effect import, matching demo) ──
import '@codingame/monaco-vscode-extension-api/localExtensionHost';

// ── Worker URLs ──
import editorWorkerUrl from '@codingame/monaco-vscode-api/workers/editor.worker?worker&url';
import extensionHostWorkerUrl from '@codingame/monaco-vscode-api/workers/extensionHost.worker?worker&url';
import textMateWorkerUrl from '@codingame/monaco-vscode-textmate-service-override/worker?worker&url';
import outputWorkerUrl from '@codingame/monaco-vscode-output-service-override/worker?worker&url';
import langDetectWorkerUrl from '@codingame/monaco-vscode-language-detection-worker-service-override/worker?worker&url';
import searchWorkerUrl from '@codingame/monaco-vscode-search-service-override/worker?worker&url';

const editorService = new ApiEditorAdapter();

/**
 * Stable remote authority used for ALL sessions.
 *
 * By using the gateway host (window.location.host) as the authority,
 * all session folder URIs share the same authority. This allows the
 * dynamic WebSocket factory to route connections to different REH
 * servers without VS Code thinking it's a different remote server.
 */
const STABLE_AUTHORITY = globalThis.location?.host ?? 'localhost';

const workerUrls: Record<string, string> = {
  editorWorkerService: editorWorkerUrl,
  extensionHostWorkerMain: extensionHostWorkerUrl,
  TextMateWorker: textMateWorkerUrl,
  OutputLinkDetectionWorker: outputWorkerUrl,
  LanguageDetectionWorker: langDetectWorkerUrl,
  LocalFileSearchWorker: searchWorkerUrl,
};

// Set MonacoEnvironment globally (must happen before initialize).
(globalThis as Record<string, unknown>).MonacoEnvironment = {
  getWorkerUrl(_workerId: string, label: string) {
    return workerUrls[label] ?? workerUrls.editorWorkerService;
  },
  getWorkerOptions() {
    return { type: 'module' as const };
  },
};

export interface InitWorkbenchParams {
  hostname: string;
  sessionId: string;
  codeEndpoint?: string;
  container: HTMLElement;
}

// Module-level lock prevents double-init from React StrictMode
// (mounts → unmounts → remounts in dev, causing two concurrent calls).
let initPromise: Promise<void> | null = null;

// VS Code extension API reference, populated after initialize + registerExtension.
// Used by switchSession() and tabStateManager to call workspace/window/commands APIs.
let vsCodeApi: typeof import('vscode') | null = null;

/** Get the VS Code extension API. Only available after initialization. */
export function getVsCodeApi(): typeof import('vscode') | null {
  return vsCodeApi;
}

export async function initWorkbench(params: InitWorkbenchParams): Promise<void> {
  if (isInitialized()) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = doInitWorkbench(params);
  return initPromise;
}

/**
 * Build a folder URI for a given session.
 */
function buildFolderUri(sessionId: string): URI {
  return URI.from({
    scheme: 'vscode-remote',
    authority: STABLE_AUTHORITY,
    path: `/volundr/sessions/${sessionId}/workspace`,
  });
}

async function doInitWorkbench({
  hostname,
  sessionId,
  codeEndpoint,
  container,
}: InitWorkbenchParams): Promise<void> {
  const config = editorService.getWorkbenchConfig(sessionId, hostname, codeEndpoint);

  // Set the initial session route so the WebSocket factory knows where to connect.
  setActiveRoute({
    sessionId,
    hostname,
    basePath: config.basePath,
  });

  // ── 1. Create IndexedDB providers (user data persistence) ──
  await createIndexedDBProviders();

  // ── 2. Init user configuration before services (prevents theme flicker) ──
  await Promise.all([initUserConfiguration('{}'), initUserKeybindings('[]')]);

  // ── 3. Build service overrides (matching demo's commonServices) ──
  const services = {
    ...getAuthenticationServiceOverride(),
    ...getLogServiceOverride(),
    ...getExtensionsServiceOverride({ enableWorkerExtensionHost: true }),
    ...getExtensionGalleryServiceOverride({ webOnly: false }),
    ...getModelServiceOverride(),
    ...getNotificationsServiceOverride(),
    ...getDialogsServiceOverride(),
    ...getConfigurationServiceOverride(),
    ...getKeybindingsServiceOverride(),
    ...getTextmateServiceOverride(),
    ...getThemeServiceOverride(),
    ...getLanguagesServiceOverride(),
    ...getDebugServiceOverride(),
    ...getPreferencesServiceOverride(),
    ...getOutlineServiceOverride(),
    ...getTimelineServiceOverride(),
    ...getBannerServiceOverride(),
    ...getStatusBarServiceOverride(),
    ...getTitleBarServiceOverride(),
    ...getSnippetsServiceOverride(),
    ...getOutputServiceOverride(),
    ...getTerminalServiceOverride(),
    ...getSearchServiceOverride(),
    ...getMarkersServiceOverride(),
    ...getAccessibilityServiceOverride(),
    ...getLanguageDetectionWorkerServiceOverride(),
    ...getStorageServiceOverride(),
    ...getRemoteAgentServiceOverride({ scanRemoteExtensions: true }),
    ...getLifecycleServiceOverride(),
    ...getEnvironmentServiceOverride(),
    ...getWorkspaceTrustServiceOverride(),
    ...getWorkingCopyServiceOverride(),
    ...getScmServiceOverride(),
    ...getTestingServiceOverride(),
    ...getWelcomeServiceOverride(),
    ...getUserDataProfileServiceOverride(),
    ...getUserDataSyncServiceOverride(),
    ...getTaskServiceOverride(),
    ...getCommentsServiceOverride(),
    ...getEditSessionsServiceOverride(),
    ...getEmmetServiceOverride(),
    ...getInteractiveServiceOverride(),
    ...getIssueServiceOverride(),
    ...getMultiDiffEditorServiceOverride(),
    ...getPerformanceServiceOverride(),
    ...getRelauncherServiceOverride(),
    ...getShareServiceOverride(),
    ...getSpeechServiceOverride(),
    ...getSurveyServiceOverride(),
    ...getUpdateServiceOverride(),
    ...getExplorerServiceOverride(),
    ...getLocalizationServiceOverride({
      async clearLocale() {
        /* no-op */
      },
      async setLocale() {
        /* no-op */
      },
      availableLanguages: [{ locale: 'en', languageName: 'English' }],
    }),
    ...getSecretStorageServiceOverride(),
    ...getQuickaccessServiceOverride({
      isKeybindingConfigurationVisible: () => true,
      shouldUseGlobalPicker: () => true,
    }),
    // Workbench must come last — it's the "meta" override
    ...getWorkbenchServiceOverride(),
  };

  // ── 4. Build workspace provider ──
  const folderUri = buildFolderUri(sessionId);

  // ── 5. Build dynamic IWebSocket factory ──
  //
  // The factory reads from the mutable activeRoute on every new connection.
  // When a session switch closes existing WebSockets, VS Code reconnects
  // through this factory — which now routes to the new session's REH server.
  const webSocketFactory = {
    create: (url: string) => {
      const route = getActiveRoute();
      const rehPrefix = route?.basePath ? `${route.basePath}reh/` : '/reh/';
      const rewritten = url.replace(/^(wss?:\/\/[^/]+)\//, `$1${rehPrefix}`);

      // Append access_token query param for gateway JWT validation,
      // matching the pattern used by chat and terminal WebSockets.
      const token = getAccessToken();
      const authedUrl = token
        ? `${rewritten}${rewritten.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`
        : rewritten;

      const ws = new WebSocket(authedUrl);
      ws.binaryType = 'arraybuffer';

      // Track so we can close on session switch.
      trackWebSocket(ws);

      return {
        onData: (listener: (data: ArrayBuffer) => void) => {
          const handler = (e: MessageEvent) => listener(e.data);
          ws.addEventListener('message', handler);
          return { dispose: () => ws.removeEventListener('message', handler) };
        },
        onOpen: (listener: () => void) => {
          ws.addEventListener('open', listener);
          return { dispose: () => ws.removeEventListener('open', listener) };
        },
        onClose: (
          listener: (e?: {
            code: number;
            reason: string;
            wasClean: boolean;
            event: unknown;
          }) => void
        ) => {
          const handler = (e: CloseEvent) =>
            listener({ code: e.code, reason: e.reason, wasClean: e.wasClean, event: e });
          ws.addEventListener('close', handler);
          return { dispose: () => ws.removeEventListener('close', handler) };
        },
        onError: (listener: (error: unknown) => void) => {
          ws.addEventListener('error', listener);
          return { dispose: () => ws.removeEventListener('error', listener) };
        },
        send: (data: ArrayBuffer | ArrayBufferView) => ws.send(data),
        close: () => ws.close(),
      };
    },
  };

  // ── 6. Call initialize (matching demo signature) ──
  await initialize(
    services,
    container,
    {
      remoteAuthority: STABLE_AUTHORITY,
      webSocketFactory,
      workspaceProvider: {
        trusted: true,
        workspace: { folderUri },
        open: async () => true,
      },
      enableWorkspaceTrust: true,
      configurationDefaults: {
        'workbench.colorTheme': 'Default Dark Modern',
      },
      productConfiguration: {
        nameShort: 'Volundr',
        nameLong: 'Volundr Code',
        extensionsGallery: {
          serviceUrl: 'https://open-vsx.org/vscode/gallery',
          resourceUrlTemplate:
            'https://open-vsx.org/vscode/unpkg/{publisher}/{name}/{version}/{path}',
          controlUrl: '',
          nlsBaseUrl: '',
        },
      },
    },
    {} // envOptions
  );

  // ── 7. Register default API extension and store the API reference ──
  //
  // The extension API gives us access to vscode.workspace, vscode.window,
  // vscode.commands, etc. We store it in a module-level variable so
  // switchSession() can use it without `import('vscode')` (which Vite
  // can't resolve at build time since `vscode` is a virtual module).
  const ext = registerExtension(
    {
      name: 'volundr',
      publisher: 'niuulabs',
      version: '1.0.0',
      engines: { vscode: '*' },
    },
    ExtensionHostKind.LocalProcess
  );
  ext.setAsDefaultApi();
  vsCodeApi = await ext.getApi();

  markInitialized();
}

/**
 * Switch the workbench to a different session without page reload.
 *
 * 1. Saves the current session's open editor tabs for later restoration.
 * 2. Closes all open editors to avoid stale file references.
 * 3. Updates the mutable routing state so new WebSocket connections
 *    go to the new session's REH server.
 * 4. Closes all existing WebSocket connections, forcing VS Code to
 *    reconnect through the factory (now routing to the new session).
 * 5. Swaps the workspace folder to the new session's workspace path.
 * 6. Restores previously saved tabs for the new session (if any).
 */
export async function switchSession(
  sessionId: string,
  hostname: string,
  codeEndpoint?: string
): Promise<void> {
  const config = editorService.getWorkbenchConfig(sessionId, hostname, codeEndpoint);
  const previousRoute = getActiveRoute();

  if (!vsCodeApi) {
    throw new Error('Cannot switch session: VS Code API not initialized');
  }

  // 1. Save the current session's open tabs before switching.
  if (previousRoute) {
    await saveTabState(previousRoute.sessionId, vsCodeApi);
  }

  // 2. Close all open editors so stale tabs don't flash errors.
  await vsCodeApi.commands.executeCommand('workbench.action.closeAllEditors');

  // 3. Update routing so new WebSocket connections go to the new REH server.
  setActiveRoute({
    sessionId,
    hostname,
    basePath: config.basePath,
  });

  // 4. Close existing WebSocket connections — VS Code will auto-reconnect.
  closeAllWebSockets();

  // 5. Swap the workspace folder.
  const newFolderUri = vsCodeApi.Uri.from({
    scheme: 'vscode-remote',
    authority: STABLE_AUTHORITY,
    path: `/volundr/sessions/${sessionId}/workspace`,
  });

  const currentFolderCount = vsCodeApi.workspace.workspaceFolders?.length ?? 0;
  vsCodeApi.workspace.updateWorkspaceFolders(0, currentFolderCount, { uri: newFolderUri });

  // 6. Restore previously saved tabs for the new session (if any).
  await restoreTabState(sessionId, STABLE_AUTHORITY, vsCodeApi);
}
