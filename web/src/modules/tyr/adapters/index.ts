import {
  MockTyrService,
  MockDispatcherService,
  MockTyrSessionService,
  MockTrackerBrowserService,
} from './mock';
import { ApiTyrService, ApiTrackerBrowserService } from './api';
import type { ITyrService } from '../ports';
import type { IDispatcherService } from '../ports';
import type { ITyrSessionService } from '../ports';
import type { ITrackerBrowserService } from '../ports';

const useRealApi = import.meta.env.VITE_USE_REAL_TYR_API === 'true';
const useMockTracker = import.meta.env.VITE_USE_MOCK_TRACKER === 'true';

export const tyrService: ITyrService = useRealApi ? new ApiTyrService() : new MockTyrService();
export const dispatcherService: IDispatcherService = new MockDispatcherService();
export const tyrSessionService: ITyrSessionService = new MockTyrSessionService();
export const trackerService: ITrackerBrowserService = useMockTracker
  ? new MockTrackerBrowserService()
  : new ApiTrackerBrowserService();
