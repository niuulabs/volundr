import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
  buildRavnPersonaAdapter,
} from '@niuulabs/plugin-ravn';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const helloService =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

  const ravnSvc = config.services['ravn'];
  const ravnPersonaService =
    ravnSvc?.mode === 'http' && ravnSvc.baseUrl
      ? buildRavnPersonaAdapter(createApiClient(ravnSvc.baseUrl))
      : createMockPersonaStore();

  return {
    hello: helloService,
    'ravn.personas': ravnPersonaService,
    'ravn.ravens': createMockRavenStream(),
    'ravn.sessions': createMockSessionStream(),
    'ravn.triggers': createMockTriggerStore(),
    'ravn.budget': createMockBudgetStream(),
  };
}
