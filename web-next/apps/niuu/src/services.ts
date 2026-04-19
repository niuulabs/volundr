import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
} from '@niuulabs/plugin-observatory';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const helloService =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

  return {
    hello: helloService,
    'observatory.registry': createMockRegistryRepository(),
    'observatory.topology': createMockTopologyStream(),
    'observatory.events': createMockEventStream(),
  };
}
