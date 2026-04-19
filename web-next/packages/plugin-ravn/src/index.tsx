import { createRoute, type AnyRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { RavnPage } from './ui/RavnPage';

export const ravnPlugin = definePlugin({
  id: 'ravn',
  rune: 'ᚱ',
  title: 'Ravn · the flock',
  subtitle: 'agent fleet console',
  routes: (rootRoute: AnyRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/ravn',
      component: RavnPage,
    }),
  ],
});

export { createMockRavnService } from './adapters/mock';
export { createHttpRavnService } from './adapters/http';
export type {
  IRavnService,
  IPersonaStore,
  IRavenStream,
  ISessionStream,
  ITriggerStore,
  IBudgetStream,
} from './ports';
export type {
  Raven,
  RavenState,
  RavenMount,
  Session,
  SessionState,
  Message,
  MessageKind,
  Trigger,
  TriggerInput,
  CronTrigger,
  EventTrigger,
  WebhookTrigger,
  ManualTrigger,
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
} from './domain';
