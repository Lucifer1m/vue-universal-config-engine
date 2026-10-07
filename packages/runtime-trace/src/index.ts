export interface RuntimeTraceEvent {
  sessionId: string;
  route: string;
  nodeId: string;
  type: 'mount' | 'update' | 'event' | 'state' | 'request';
  timestamp: number;
  payload: Record<string, unknown>;
}
export interface RuntimeTraceSink { write(event: RuntimeTraceEvent): void | Promise<void>; }
export class MemoryRuntimeTraceSink implements RuntimeTraceSink {
  events: RuntimeTraceEvent[] = [];
  write(event: RuntimeTraceEvent): void { this.events.push(event); }
}
