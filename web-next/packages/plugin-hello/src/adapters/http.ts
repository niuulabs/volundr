import type { ApiClient } from '@niuulabs/query';
import type { Greeting, IHelloService } from '../ports';

/**
 * Create a hello service backed by an HTTP API.
 * @param client - An ApiClient pointed at the hello service endpoint
 */
export function createHttpHelloService(client: ApiClient): IHelloService {
  return {
    async listGreetings(): Promise<Greeting[]> {
      return client.get<Greeting[]>('/greetings');
    },
  };
}
