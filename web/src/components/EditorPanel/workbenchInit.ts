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
 * @see https://github.com/CodinGame/monaco-vscode-api/tree/main/demo
 */
import { getAccessToken } from '@/adapters/api/client';
import { createBearerWebSocketFactory } from '@/utils/bearerWebSocketFactory';
import { ApiEditorAdapter } from '@/adapters/api/editor.adapter';
import { isInitialized, getInitializedSessionId, markInitialized } from './editorState';

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

export async function initWorkbench(params: InitWorkbenchParams): Promise<void> {
  if (isInitialized() && getInitializedSessionId() === params.sessionId) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }
  initPromise = doInitWorkbench(params);
  return initPromise;
}

async function doInitWorkbench({
  hostname,
  sessionId,
  codeEndpoint,
  container,
}: InitWorkbenchParams): Promise<void> {
  const config = editorService.getWorkbenchConfig(sessionId, hostname, codeEndpoint);
  const wsFactory = createBearerWebSocketFactory({ getToken: getAccessToken });

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
  const folderUri = URI.from({
    scheme: 'vscode-remote',
    authority: config.remoteAuthority,
    path: `/volundr/sessions/${sessionId}/workspace`,
  });

  // ── 5. Build IWebSocket factory ──
  const webSocketFactory = {
    create: (url: string) => {
      const rehPrefix = config.basePath ? `${config.basePath}reh/` : '/reh/';
      const rewritten = url.replace(/^(wss?:\/\/[^/]+)\//, `$1${rehPrefix}`);
      const ws = wsFactory(rewritten);
      ws.binaryType = 'arraybuffer';

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
      remoteAuthority: config.remoteAuthority,
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

  // ── 7. Register default API extension (matching demo) ──
  registerExtension(
    {
      name: 'volundr',
      publisher: 'niuulabs',
      version: '1.0.0',
      engines: { vscode: '*' },
    },
    ExtensionHostKind.LocalProcess
  ).setAsDefaultApi();

  markInitialized(sessionId);
}
