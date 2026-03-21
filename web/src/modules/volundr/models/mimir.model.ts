export interface MimirStats {
  totalConsultations: number;
  consultationsToday: number;
  tokensUsedToday: number;
  tokensUsedMonth: number;
  costToday: number;
  costMonth: number;
  avgResponseTime: number;
  model: string;
}

export interface MimirConsultation {
  id: string;
  time: string;
  requester: string;
  topic: string;
  query: string;
  response: string;
  tokensIn: number;
  tokensOut: number;
  latency: number;
  useful: boolean;
}
