import { createMockHelloService, createHttpHelloService } from '@niuulabs/plugin-hello';
import { createMockMimirService, createHttpMimirService } from '@niuulabs/plugin-mimir';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloConfig = config.services.hello;
  const helloService =
    helloConfig?.mode === 'http' && helloConfig.baseUrl
      ? createHttpHelloService(createApiClient(helloConfig.baseUrl))
      : createMockHelloService();

  const mimirConfig = config.services.mimir;
  const mimirService =
    mimirConfig?.mode === 'http' && mimirConfig.baseUrl
      ? createHttpMimirService(createApiClient(mimirConfig.baseUrl))
      : createMockMimirService();

  return {
    hello: helloService,
    mimir: mimirService,
  };
}
