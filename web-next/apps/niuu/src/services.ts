import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  if (helloSvc?.mode === 'http' && helloSvc.baseUrl) {
    return {
      hello: buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl)),
    };
  }
  return {
    hello: createMockHelloService(),
  };
}
