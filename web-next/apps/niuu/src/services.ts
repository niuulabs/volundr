import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
  buildRavnPersonaAdapter,
  buildRavnRavenAdapter,
  buildRavnSessionAdapter,
  buildRavnTriggerAdapter,
  buildRavnBudgetAdapter,
} from '@niuulabs/plugin-ravn';
import {
  createMockTyrService,
  createMockDispatcherService,
  createMockTyrSessionService,
  createMockTrackerService,
  createMockDispatchBus,
  buildTyrHttpAdapter,
  buildDispatcherHttpAdapter,
  buildTyrSessionHttpAdapter,
  buildTrackerHttpAdapter,
  buildDispatchBusHttpAdapter,
} from '@niuulabs/plugin-tyr';
import { createMimirMockAdapter, buildMimirHttpAdapter } from '@niuulabs/plugin-mimir';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
  buildObservatoryRegistryHttpAdapter,
  buildObservatoryTopologySseStream,
  buildObservatoryEventsSseStream,
} from '@niuulabs/plugin-observatory';
import {
  createMockVolundrService,
  buildVolundrHttpAdapter,
  createMockPtyStream,
  createMockMetricsStream,
  createMockFileSystemPort,
  buildVolundrPtyWsAdapter,
  buildVolundrMetricsSseAdapter,
  createMockClusterAdapter,
  createMockSessionStore,
} from '@niuulabs/plugin-volundr';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServiceConfig, ServicesMap } from '@niuulabs/plugin-sdk';

/**
 * A service config is "live" (i.e. should use a real transport) when its mode
 * is `http` or `ws` and a URL is present. Any other combination — missing
 * mode, `mock`, or missing URL — falls back to the mock adapter.
 */
function hasHttpBackend(
  svc: ServiceConfig | undefined,
): svc is ServiceConfig & { baseUrl: string } {
  return svc?.mode === 'http' && typeof svc.baseUrl === 'string';
}

function hasWsBackend(svc: ServiceConfig | undefined): svc is ServiceConfig & { wsUrl: string } {
  return svc?.mode === 'ws' && typeof svc.wsUrl === 'string';
}

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const ravnSvc = config.services['ravn'];
  const tyrSvc = config.services['tyr'];
  const mimirSvc = config.services['mimir'];
  const volundrSvc = config.services['volundr'];
  const volundrPtySvc = config.services['volundr.pty'];
  const volundrMetricsSvc = config.services['volundr.metrics'];
  const obsRegistrySvc = config.services['observatory.registry'];
  const obsTopologySvc = config.services['observatory.topology'];
  const obsEventsSvc = config.services['observatory.events'];

  // ── Hello ──
  const hello = hasHttpBackend(helloSvc)
    ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
    : createMockHelloService();

  // ── Ravn: all five sub-services share one HTTP base URL when configured ──
  const ravnClient = hasHttpBackend(ravnSvc) ? createApiClient(ravnSvc.baseUrl) : null;
  const ravnPersonas = ravnClient ? buildRavnPersonaAdapter(ravnClient) : createMockPersonaStore();
  const ravnRavens = ravnClient ? buildRavnRavenAdapter(ravnClient) : createMockRavenStream();
  const ravnSessions = ravnClient ? buildRavnSessionAdapter(ravnClient) : createMockSessionStream();
  const ravnTriggers = ravnClient ? buildRavnTriggerAdapter(ravnClient) : createMockTriggerStore();
  const ravnBudget = ravnClient ? buildRavnBudgetAdapter(ravnClient) : createMockBudgetStream();

  // ── Mímir ──
  const mimir = hasHttpBackend(mimirSvc)
    ? buildMimirHttpAdapter(createApiClient(mimirSvc.baseUrl))
    : createMimirMockAdapter();

  // ── Völundr request/response ──
  const volundr = hasHttpBackend(volundrSvc)
    ? buildVolundrHttpAdapter(createApiClient(volundrSvc.baseUrl))
    : createMockVolundrService();

  // ── Völundr streams: keyed as separate services so they can be flipped
  //    independently (e.g. mock PTY with live metrics during bring-up). ──
  const ptyStream = hasWsBackend(volundrPtySvc)
    ? buildVolundrPtyWsAdapter({ urlTemplate: volundrPtySvc.wsUrl })
    : createMockPtyStream();
  const metricsStream = hasHttpBackend(volundrMetricsSvc)
    ? buildVolundrMetricsSseAdapter({ urlTemplate: volundrMetricsSvc.baseUrl })
    : createMockMetricsStream();

  // ── Observatory ──
  const observatoryRegistry = hasHttpBackend(obsRegistrySvc)
    ? buildObservatoryRegistryHttpAdapter(createApiClient(obsRegistrySvc.baseUrl))
    : createMockRegistryRepository();
  const observatoryTopology = hasHttpBackend(obsTopologySvc)
    ? buildObservatoryTopologySseStream(obsTopologySvc.baseUrl)
    : createMockTopologyStream();
  const observatoryEvents = hasHttpBackend(obsEventsSvc)
    ? buildObservatoryEventsSseStream(obsEventsSvc.baseUrl)
    : createMockEventStream();

  // ── Tyr ──
  const tyrClient = hasHttpBackend(tyrSvc) ? createApiClient(tyrSvc.baseUrl) : null;
  const tyrService = tyrClient ? buildTyrHttpAdapter(tyrClient) : createMockTyrService();
  const dispatcherService = tyrClient
    ? buildDispatcherHttpAdapter(tyrClient)
    : createMockDispatcherService();
  const tyrSessionService = tyrClient
    ? buildTyrSessionHttpAdapter(tyrClient)
    : createMockTyrSessionService();
  const trackerService = tyrClient
    ? buildTrackerHttpAdapter(tyrClient)
    : createMockTrackerService();
  const dispatchBus = tyrClient ? buildDispatchBusHttpAdapter(tyrClient) : createMockDispatchBus();

  return {
    hello,
    tyr: tyrService,
    'tyr.dispatcher': dispatcherService,
    'tyr.sessions': tyrSessionService,
    'tyr.tracker': trackerService,
    'tyr.dispatch': dispatchBus,
    'ravn.personas': ravnPersonas,
    'ravn.ravens': ravnRavens,
    'ravn.sessions': ravnSessions,
    'ravn.triggers': ravnTriggers,
    'ravn.budget': ravnBudget,
    mimir,
    volundr,
    ptyStream,
    metricsStream,
    filesystem: createMockFileSystemPort(),
    clusterAdapter: createMockClusterAdapter(),
    sessionStore: createMockSessionStore(),
    'observatory.registry': observatoryRegistry,
    'observatory.topology': observatoryTopology,
    'observatory.events': observatoryEvents,
  };
}
