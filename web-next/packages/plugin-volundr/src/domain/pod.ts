/** Source of a pod volume mount. */
export type MountSourceKind = 'git' | 'pvc' | 'secret' | 'configmap';

/** A single volume mounted into the pod. */
export interface PodMount {
  readonly name: string;
  readonly mountPath: string;
  readonly sourceKind: MountSourceKind;
  readonly source: string;
  readonly readOnly: boolean;
}

/** CPU / memory / GPU resource numbers for a pod. Values use SI units (millicores, MiB). */
export interface ResourceSpec {
  readonly cpuRequest: number;
  readonly cpuLimit: number;
  readonly memRequestMi: number;
  readonly memLimitMi: number;
  readonly gpuCount: number;
}

/** Full specification of a pod that Völundr will provision. */
export interface PodSpec {
  readonly image: string;
  readonly mounts: readonly PodMount[];
  readonly env: Readonly<Record<string, string>>;
  readonly resources: ResourceSpec;
}
