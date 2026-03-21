import type { ITyrService } from '../../ports';
import type { Saga, Phase } from '../../models';

const _TYR_API_BASE = '/api/tyr';

export class ApiTyrService implements ITyrService {
  async getSagas(): Promise<Saga[]> {
    throw new Error('Not implemented — see NIU-190');
  }
  async getSaga(_id: string): Promise<Saga | null> {
    throw new Error('Not implemented — see NIU-190');
  }
  async getPhases(_sagaId: string): Promise<Phase[]> {
    throw new Error('Not implemented — see NIU-190');
  }
  async createSaga(_spec: string, _repo: string): Promise<Saga> {
    throw new Error('Not implemented — see NIU-190');
  }
  async decompose(_spec: string, _repo: string): Promise<Phase[]> {
    throw new Error('Not implemented — see NIU-190');
  }
}
