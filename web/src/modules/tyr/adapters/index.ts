import { MockTyrService, MockDispatcherService, MockTyrSessionService } from './mock';
import { ApiTyrService } from './api';
import type { ITyrService } from '../ports';
import type { IDispatcherService } from '../ports';
import type { ITyrSessionService } from '../ports';

const useRealApi = import.meta.env.VITE_USE_REAL_TYR_API === 'true';

export const tyrService: ITyrService = useRealApi ? new ApiTyrService() : new MockTyrService();
export const dispatcherService: IDispatcherService = new MockDispatcherService();
export const tyrSessionService: ITyrSessionService = new MockTyrSessionService();
