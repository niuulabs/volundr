import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './ui/App';
import { loadInstances } from './config/instances';
import { HttpMimirAdapter } from './adapters/mimir/HttpMimirAdapter';
import { HttpIngestAdapter } from './adapters/ingest/HttpIngestAdapter';
import { HttpGraphAdapter } from './adapters/graph/HttpGraphAdapter';
import { WebSocketEventAdapter } from './adapters/events/WebSocketEventAdapter';
import { PollingEventAdapter } from './adapters/events/PollingEventAdapter';
import type { InstancePorts } from './contexts/PortsContext';
import './styles/tokens.css';
import './styles/reset.css';

const configs = loadInstances();

function buildWsUrl(httpUrl: string): string {
  return httpUrl.replace(/^https?:\/\//, (match) => (match === 'https://' ? 'wss://' : 'ws://')) + '/ws';
}

const instancePorts: InstancePorts[] = configs.map((instance) => {
  const wsAdapter = new WebSocketEventAdapter(buildWsUrl(instance.url));
  const pollingAdapter = new PollingEventAdapter(`${instance.url}/log`);

  return {
    instance,
    api: new HttpMimirAdapter(instance.url),
    ingest: new HttpIngestAdapter(instance.url),
    graph: new HttpGraphAdapter(instance.url),
    events: wsAdapter.isConnected() ? wsAdapter : pollingAdapter,
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
