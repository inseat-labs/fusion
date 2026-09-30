import type { LegState, ProgressEvent, ProgressStream } from "../schemas/progress.js";

/** Records real leg transitions in the same ProgressStream contract the dry-run simulator uses. */
export class RuntimeProgress {
  private readonly events: ProgressEvent[] = [];
  private nextLeg = 0;
  private lastTs = 0;

  constructor(
    private readonly workflowId: string,
    private readonly onEvent: (event: ProgressEvent) => void = () => undefined,
  ) {}

  startLeg(description: string): string {
    const legId = `leg-${this.nextLeg++}`;
    this.push(legId, "planned", "leg-created", description);
    this.push(legId, "ready", "gates-satisfied", description);
    this.push(legId, "running", "process-started", description);
    return legId;
  }

  endLeg(legId: string, state: LegState, code: string, message: string, evidenceRef?: string): void {
    this.push(legId, state, code, message, evidenceRef);
  }

  stream(): ProgressStream {
    return { version: 1, workflowId: this.workflowId, origin: "runtime", events: [...this.events] };
  }

  private push(legId: string, state: LegState, code: string, message: string, evidenceRef?: string): void {
    this.lastTs = Math.max(Date.now(), this.lastTs);
    const event: ProgressEvent = {
      version: 1,
      workflowId: this.workflowId,
      legId,
      sequence: this.events.length,
      timestamp: new Date(this.lastTs).toISOString(),
      state,
      reason: { code, message: message || code },
      origin: "runtime",
      ...(evidenceRef ? { evidenceRef } : {}),
    };
    this.events.push(event);
    this.onEvent(event);
  }
}
