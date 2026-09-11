import type { PipelineEvent } from "../lib/types";
import type { Logger } from "./client";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** A PipelineEvent without its timestamp; the Timeline stamps `t`. */
export type EventBody = DistributiveOmit<PipelineEvent, "t">;

/**
 * Collects the ordered event timeline for a run and forwards each event to a
 * listener (SSE, stderr). `t` is seconds since the timeline started, rounded
 * to 10ms.
 */
export class Timeline {
  readonly events: PipelineEvent[] = [];
  private readonly startMs: number;

  constructor(
    private readonly nowMs: () => number,
    private readonly onEvent?: (event: PipelineEvent) => void,
    private readonly logger?: Logger,
  ) {
    this.startMs = nowMs();
  }

  /** Seconds since start. */
  t(): number {
    return Math.round((this.nowMs() - this.startMs) / 10) / 100;
  }

  elapsedMs(): number {
    return this.nowMs() - this.startMs;
  }

  emit(body: EventBody): PipelineEvent {
    const event = { t: this.t(), ...body } as PipelineEvent;
    this.events.push(event);
    this.onEvent?.(event);
    return event;
  }

  log(message: string): void {
    this.logger?.info?.(message);
    this.emit({ type: "log", message });
  }
}

/** Snapshot of the run's token ledger, used by `counters` events and log lines. */
export interface CounterSnapshot {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheHitRate: number;
}
