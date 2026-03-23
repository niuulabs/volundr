import {
  MockTyrService,
  MockDispatcherService,
  MockTyrSessionService,
  MockTrackerBrowserService,
} from './mock';
import { ApiTyrService, ApiDispatcherService, ApiTrackerBrowserService } from './api';
import type { ITyrService } from '../ports';
import type { IDispatcherService } from '../ports';
import type { ITyrSessionService } from '../ports';
import type { ITrackerBrowserService } from '../ports';

const useMocks = import.meta.env.VITE_USE_MOCK_TYR === 'true';

export const tyrService: ITyrService = useMocks ? new MockTyrService() : new ApiTyrService();
export const dispatcherService: IDispatcherService = useMocks
  ? new MockDispatcherService()
  : new ApiDispatcherService();
export const tyrSessionService: ITyrSessionService = new MockTyrSessionService();
export const trackerService: ITrackerBrowserService = useMocks
  ? new MockTrackerBrowserService()
  : new ApiTrackerBrowserService();
