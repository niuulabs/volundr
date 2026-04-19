import { createMockHelloService, buildHelloHttpAdapter } from '@niuulabs/plugin-hello';
import { createMimirMockAdapter, buildMimirHttpAdapter } from '@niuulabs/plugin-mimir';
import {
  createMockRegistryRepository,
  createMockTopologyStream,
  createMockEventStream,
} from '@niuulabs/plugin-observatory';
import {
  createMockVolundrService,
  createMockClusterAdapter,
  createMockTemplateStore,
  createMockSessionStore,
  buildVolundrHttpAdapter,
  createMockPtyStream,
  createMockFileSystemPort,
} from '@niuulabs/plugin-volundr';
import { createApiClient } from '@niuulabs/query';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(config: NiuuConfig): ServicesMap {
  const helloSvc = config.services['hello'];
  const mimirSvc = config.services['mimir'];
  const volundrSvc = config.services['volundr'];

  const hello =
    helloSvc?.mode === 'http' && helloSvc.baseUrl
      ? buildHelloHttpAdapter(createApiClient(helloSvc.baseUrl))
      : createMockHelloService();

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
    mimir,
    volundr,
    ptyStream: createMockPtyStream(),
    filesystem: createMockFileSystemPort(),
    'volundr.clusters': createMockClusterAdapter(),
    'volundr.templates': createMockTemplateStore(),
    'volundr.sessions': createMockSessionStore(),
    'observatory.registry': createMockRegistryRepository(),
    'observatory.topology': createMockTopologyStream(),
    'observatory.events': createMockEventStream(),
  };
}
