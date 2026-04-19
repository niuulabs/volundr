import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import { createMockVolundrService, buildVolundrHttpAdapter } from '@niuulabs/plugin-volundr';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const volundrSvc = config.services['volundr'];

  const hello =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

  const volundr =
    volundrSvc?.mode === 'http' && volundrSvc.baseUrl
      ? buildVolundrHttpAdapter(createApiClient(volundrSvc.baseUrl))
      : createMockVolundrService();

  return { hello, volundr };
}
