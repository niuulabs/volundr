import type { ChronicleType, ActionZone, Severity } from './status.model';

export interface ChronicleEntry {
  time: string;
  type: ChronicleType;
  agent: string;
  message: string;
  details?: string;
  severity?: Severity;
  zone?: ActionZone;
}
