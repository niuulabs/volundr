import { createRoute } from '@tanstack/react-router';
import { definePlugin } from '@niuulabs/plugin-sdk';
import { RavnPage } from './ui/RavnPage';

export const ravnPlugin = definePlugin({
  id: 'ravn',
  rune: 'ᚱ',
  title: 'Ravn',
  subtitle: 'personas · ravens · sessions',
  routes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: '/ravn',
      component: RavnPage,
    }),
  ],
});

// Mock adapters
export {
  createMockPersonaStore,
  createMockRavenStream,
  createMockSessionStream,
  createMockTriggerStore,
  createMockBudgetStream,
} from './adapters/mock';

// HTTP adapters
export {
  buildRavnPersonaAdapter,
  buildRavnRavenAdapter,
  buildRavnSessionAdapter,
  buildRavnTriggerAdapter,
  buildRavnBudgetAdapter,
} from './adapters/http';

// Port interfaces + types
export type {
  IPersonaStore,
  IRavenStream,
  ISessionStream,
  ITriggerStore,
  IBudgetStream,
  PersonaSummary,
  PersonaDetail,
  PersonaCreateRequest,
  PersonaForkRequest,
  PersonaFilter,
  PersonaLLM,
  PersonaProduces,
  PersonaConsumes,
  PersonaFanIn,
} from './ports';

// Domain types
export { ravnStatusSchema, ravnSchema, type RavnStatus, type Ravn } from './domain/ravn';
export {
  sessionStatusSchema,
  sessionSchema,
  type SessionStatus,
  type Session,
} from './domain/session';
export { triggerKindSchema, triggerSchema, type TriggerKind, type Trigger } from './domain/trigger';
export { messageKindSchema, messageSchema, type MessageKind, type Message } from './domain/message';
