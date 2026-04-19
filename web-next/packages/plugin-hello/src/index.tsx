import { definePlugin } from '@niuulabs/plugin-sdk';
import { HelloPage } from './ui/HelloPage';

export const helloPlugin = definePlugin({
  id: 'hello',
  rune: 'ᚺ',
  title: 'Hello',
  subtitle: 'smoke test plugin',
  render: () => <HelloPage />,
});

export { createMockHelloService } from './adapters/mock';
export { createHttpHelloService } from './adapters/http';
export type { IHelloService, Greeting } from './ports';
