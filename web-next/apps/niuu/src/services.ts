import { createMockHelloService, createHttpHelloService } from '@niuulabs/plugin-hello';
import {
  createMockRegistryRepository,
  createMockLiveTopologyStream,
  createMockEventStream,
} from '@niuulabs/plugin-observatory';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloConfig = config.services.hello;
  const helloService =
    helloConfig?.mode === 'http' && helloConfig.baseUrl
      ? createHttpHelloService(createApiClient(helloConfig.baseUrl))
      : createMockHelloService();

  return {
    hello: helloService,
    'observatory.registry': createMockRegistryRepository(),
    'observatory.topology': createMockLiveTopologyStream(),
    'observatory.events': createMockEventStream(),
  };
}
