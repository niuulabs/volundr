import { createMockHelloService } from '@niuulabs/plugin-hello';
import type { NiuuConfig, ServicesMap } from '@niuulabs/plugin-sdk';

export function buildServices(_config: NiuuConfig): ServicesMap {
  return {
    hello: createMockHelloService(),
  };
}
