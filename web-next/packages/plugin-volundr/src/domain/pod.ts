/** Pod domain — image, mounts, resources, and tool configuration for a dev pod. */

export type MountKind = 'git' | 'pvc' | 'secret' | 'configmap';

export interface GitMountSource {
  kind: 'git';
  repo: string;
  branch: string;
}

export interface PvcMountSource {
  kind: 'pvc';
  name: string;
}

export interface SecretMountSource {
  kind: 'secret';
  name: string;
}

export interface ConfigMapMountSource {
  kind: 'configmap';
  name: string;
}

export type MountSource =
  | GitMountSource
  | PvcMountSource
  | SecretMountSource
  | ConfigMapMountSource;

export interface Mount {
  name: string;
  mountPath: string;
  source: MountSource;
  readOnly: boolean;
}

export interface ResourceSpec {
  cpuRequest: string;
  cpuLimit: string;
  memRequestMi: number;
  memLimitMi: number;
  gpuCount: number;
}

/** Full specification for a pod — runtime config + resource bounds. */
export interface PodSpec {
  image: string;
  tag: string;
  mounts: Mount[];
  env: Record<string, string>;
  envSecretRefs: string[];
  /** Tool IDs from Ravn's registry that this pod exposes to its bound raven. */
  tools: string[];
  resources: ResourceSpec;
  /** Maximum session duration in seconds. */
  ttlSec: number;
  /** Auto-terminate after this many seconds of inactivity. */
  idleTimeoutSec: number;
  clusterAffinity?: string[];
  tolerations?: string[];
}
