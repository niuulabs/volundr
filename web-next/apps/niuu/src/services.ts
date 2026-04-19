import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import { createMimirMockAdapter, buildMimirHttpAdapter } from '@niuulabs/plugin-mimir';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const mimirSvc = config.services['mimir'];

  const hello =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

  const mimir =
    mimirSvc?.mode === 'http' && mimirSvc.baseUrl
      ? buildMimirHttpAdapter(createApiClient(mimirSvc.baseUrl))
      : createMimirMockAdapter();

  return { hello, mimir };
}
