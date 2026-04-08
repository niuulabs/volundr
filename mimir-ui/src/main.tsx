import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { loadInstances } from './config/instances';
import { HttpMimirAdapter } from './adapters/mimir/HttpMimirAdapter';
import { HttpIngestAdapter } from './adapters/ingest/HttpIngestAdapter';
import { HttpGraphAdapter } from './adapters/graph/HttpGraphAdapter';
import { WebSocketEventAdapter } from './adapters/events/WebSocketEventAdapter';
import type { InstancePorts } from './contexts/PortsContext';
import './styles/tokens.css';
import './styles/reset.css';

const configs = loadInstances();

function buildWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//, (match) => (match === 'https://' ? 'wss://' : 'ws://')) + '/ws';
}

const instancePorts: InstancePorts[] = configs.map((instance) => {
  // WebSocketEventAdapter connects lazily on first subscribe() call and handles
  // failure gracefully — always use it as the primary event source.
  // PollingEventAdapter is available as a manual fallback but not the default.
  const wsAdapter = new WebSocketEventAdapter(buildWsUrl(instance.url));

  return {
    instance,
    api: new HttpMimirAdapter(instance.url),
    ingest: new HttpIngestAdapter(instance.url),
    graph: new HttpGraphAdapter(instance.url),
    events: wsAdapter,
  };
});

const defaultInstanceName = configs[0]?.name ?? 'local';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App instances={instancePorts} defaultInstanceName={defaultInstanceName} />
  </React.StrictMode>,
);
