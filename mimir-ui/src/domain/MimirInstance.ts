export type InstanceRole = 'local' | 'shared' | 'domain';

export interface MimirInstance {
  name: string;
  url: string;
  role: InstanceRole;
  writeEnabled: boolean;
}
