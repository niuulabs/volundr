export { definePlugin, type PluginDescriptor, type PluginCtx } from './PluginDescriptor';
export { ServicesProvider, useService, type ServicesMap } from './ServicesProvider';
export { ConfigProvider, useConfig } from './ConfigProvider';
export { FeatureCatalogProvider, useFeatureCatalog, type FeatureCatalog } from './FeatureCatalog';
export {
  niuuConfigSchema,
  pluginConfigSchema,
  serviceConfigSchema,
  type NiuuConfig,
  type PluginConfig,
  type ServiceConfig,
} from './config';
