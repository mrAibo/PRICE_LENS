import type {
  PriceProviderId,
  ProviderState,
  WarningCode
} from "@price-lens/contracts";

export interface ProviderDiagnostic {
  provider: PriceProviderId;
  state: ProviderState;
  latencyMs?: number;
  reviewCandidateCount: number;
}

export interface CompareCompletedDiagnostic {
  type: "compare_completed";
  requestId: string;
  route: "/v1/compare";
  status: 200;
  durationMs: number;
  offerCount: number;
  warningCount: number;
  warningCodes: WarningCode[];
  enrichmentFallback: boolean;
  providers: ProviderDiagnostic[];
}

export interface RequestRejectedDiagnostic {
  type: "request_rejected";
  requestId: string;
  route: string;
  status: 400 | 404 | 413 | 503;
  reason:
    | "invalid_request"
    | "invalid_json"
    | "payload_too_large"
    | "not_found"
    | "server_busy";
  durationMs: number;
}

export interface ProviderMetricsSnapshot {
  provider: PriceProviderId;
  observations: number;
  stateCounts: Partial<Record<ProviderState, number>>;
  latency: {
    count: number;
    averageMs: number;
    maxMs: number;
  };
  reviewCandidateCount: number;
}

export interface OperationalMetricsSnapshot {
  type: "metrics_snapshot";
  sampleCount: number;
  compareCompleted: number;
  requestRejected: number;
  rejectionReasons: Partial<Record<RequestRejectedDiagnostic["reason"], number>>;
  offerCount: number;
  warningCount: number;
  warningCodes: Partial<Record<WarningCode, number>>;
  enrichmentFallbackCount: number;
  providers: ProviderMetricsSnapshot[];
}

export type PriceLensDiagnosticEvent =
  | CompareCompletedDiagnostic
  | RequestRejectedDiagnostic
  | OperationalMetricsSnapshot;

export type PriceLensDiagnosticSink = (
  event: PriceLensDiagnosticEvent
) => void;


export interface DiagnosticAggregator {
  sink: PriceLensDiagnosticSink;
  snapshot(): OperationalMetricsSnapshot;
}

export function createAggregatingDiagnosticSink(
  downstream: PriceLensDiagnosticSink,
  emitEvery = 100
): DiagnosticAggregator {
  if (!Number.isInteger(emitEvery) || emitEvery < 1) {
    throw new Error("emitEvery must be a positive integer.");
  }

  let sampleCount = 0;
  let compareCompleted = 0;
  let requestRejected = 0;
  let offerCount = 0;
  let warningCount = 0;
  let enrichmentFallbackCount = 0;
  const warningCodes = new Map<WarningCode, number>();
  const rejectionReasons = new Map<RequestRejectedDiagnostic["reason"], number>();
  const providerMetrics = new Map<
    PriceProviderId,
    {
      observations: number;
      stateCounts: Map<ProviderState, number>;
      latencyCount: number;
      latencyTotalMs: number;
      latencyMaxMs: number;
      reviewCandidateCount: number;
    }
  >();

  function snapshot(): OperationalMetricsSnapshot {
    return {
      type: "metrics_snapshot",
      sampleCount,
      compareCompleted,
      requestRejected,
      rejectionReasons: Object.fromEntries(rejectionReasons),
      offerCount,
      warningCount,
      warningCodes: Object.fromEntries(warningCodes),
      enrichmentFallbackCount,
      providers: [...providerMetrics.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([provider, metrics]) => ({
          provider,
          observations: metrics.observations,
          stateCounts: Object.fromEntries(metrics.stateCounts),
          latency: {
            count: metrics.latencyCount,
            averageMs:
              metrics.latencyCount === 0
                ? 0
                : roundMetric(metrics.latencyTotalMs / metrics.latencyCount),
            maxMs: metrics.latencyMaxMs
          },
          reviewCandidateCount: metrics.reviewCandidateCount
        }))
    };
  }

  const sink: PriceLensDiagnosticSink = (event) => {
    if (event.type === "metrics_snapshot") {
      downstream(event);
      return;
    }

    sampleCount += 1;

    if (event.type === "request_rejected") {
      requestRejected += 1;
      rejectionReasons.set(
        event.reason,
        (rejectionReasons.get(event.reason) ?? 0) + 1
      );
    } else {
      compareCompleted += 1;
      offerCount += event.offerCount;
      warningCount += event.warningCount;
      for (const code of event.warningCodes) {
        warningCodes.set(code, (warningCodes.get(code) ?? 0) + 1);
      }
      if (event.enrichmentFallback) enrichmentFallbackCount += 1;

      for (const provider of event.providers) {
        const current = providerMetrics.get(provider.provider) ?? {
          observations: 0,
          stateCounts: new Map<ProviderState, number>(),
          latencyCount: 0,
          latencyTotalMs: 0,
          latencyMaxMs: 0,
          reviewCandidateCount: 0
        };

        current.observations += 1;
        current.stateCounts.set(
          provider.state,
          (current.stateCounts.get(provider.state) ?? 0) + 1
        );
        current.reviewCandidateCount += provider.reviewCandidateCount;

        if (provider.latencyMs !== undefined) {
          current.latencyCount += 1;
          current.latencyTotalMs += provider.latencyMs;
          current.latencyMaxMs = Math.max(
            current.latencyMaxMs,
            provider.latencyMs
          );
        }

        providerMetrics.set(provider.provider, current);
      }
    }

    downstream(event);
    if (sampleCount % emitEvery === 0) {
      downstream(snapshot());
    }
  };

  return {sink, snapshot};
}

function roundMetric(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function createJsonLineDiagnosticSink(
  write: (line: string) => void = (line) => process.stdout.write(line),
  now: () => string = () => new Date().toISOString()
): PriceLensDiagnosticSink {
  return (event) => {
    write(
      JSON.stringify({
        timestamp: now(),
        service: "price-lens-api",
        ...event
      }) + "\n"
    );
  };
}

export function safeEmitDiagnostic(
  sink: PriceLensDiagnosticSink | undefined,
  event: PriceLensDiagnosticEvent
): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Diagnostics must never break the user-facing request path.
  }
}
