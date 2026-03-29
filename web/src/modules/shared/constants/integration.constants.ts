export const INTEGRATION_TYPES = {
  CODE_FORGE: 'code_forge',
  SOURCE_CONTROL: 'source_control',
  MESSAGING: 'messaging',
} as const;

export const ADAPTER_PATHS = {
  VOLUNDR_HTTP: 'tyr.adapters.volundr_http.VolundrHTTPAdapter',
  GITHUB: 'tyr.adapters.git.github.GitHubAdapter',
} as const;
