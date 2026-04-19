import { useEffect, useState } from 'react';
import { useService } from '@niuulabs/plugin-sdk';
import type { ILiveTopologyStream } from '../ports/ILiveTopologyStream';
import type { TopologySnapshot } from '../domain/topology';

/**
 * Subscribe to the live topology stream and return the latest snapshot.
 *
 * Data comes exclusively from the injected ILiveTopologyStream port — the
 * component never imports a concrete adapter.
 */
export function useTopologyStream(): TopologySnapshot | null {
  const stream = useService<ILiveTopologyStream>('observatory.topology');
  const [snapshot, setSnapshot] = useState<TopologySnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = stream.subscribe(setSnapshot);
    return unsubscribe;
  }, [stream]);

  return snapshot;
}
