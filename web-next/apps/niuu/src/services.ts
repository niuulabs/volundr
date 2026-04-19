import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
  buildRavnPersonaAdapter,
} from '@niuulabs/plugin-ravn';
import { createMimirMockAdapter, buildMimirHttpAdapter } from '@niuulabs/plugin-mimir';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
} from '@niuulabs/plugin-observatory';
import { createMockVolundrService, buildVolundrHttpAdapter } from '@niuulabs/plugin-volundr';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const ravnSvc = config.services['ravn'];
  const mimirSvc = config.services['mimir'];
  const volundrSvc = config.services['volundr'];

  const hello =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

  const ravnPersonaService =
    ravnSvc?.mode === 'http' && ravnSvc.baseUrl
      ? buildRavnPersonaAdapter(createApiClient(ravnSvc.baseUrl))
      : createMockPersonaStore();

  const mimir =
    mimirSvc?.mode === 'http' && mimirSvc.baseUrl
      ? buildMimirHttpAdapter(createApiClient(mimirSvc.baseUrl))
      : createMimirMockAdapter();

  const volundr =
    volundrSvc?.mode === 'http' && volundrSvc.baseUrl
      ? buildVolundrHttpAdapter(createApiClient(volundrSvc.baseUrl))
      : createMockVolundrService();

  return {
    hello,
    'ravn.personas': ravnPersonaService,
    'ravn.ravens': createMockRavenStream(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.budget': createMockBudgetStream(),
    mimir,
    volundr,
    'observatory.registry': createMockRegistryRepository(),
    'observatory.topology': createMockTopologyStream(),
    'observatory.events': createMockEventStream(),
  };
}
