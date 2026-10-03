import type {
  MatchMethod,
  PriceProviderId,
  ProviderFailureCategory,
  ProviderState
} from "@price-lens/contracts";
import type {
  ProviderCacheEvent,
  ProviderCacheOutcome,
  ProviderCacheSource
} from "./provider-cache.js";
import type {
  ProviderFanoutEvent,
  ProviderFanoutSource
} from "./provider-fanout.js";

export type ComparisonWarningCategory =
  | "extraction_warning"
  | "ebay_shipping_unknown"
  | "enrichment_fallback"
  | "fx_normalization";

export type MatchMethodCounts = Partial<Record<MatchMethod, number>>;
export type WarningCategoryCounts = Partial<Record<ComparisonWarningCategory, number>>;

export interface ProviderDiagnostic {
  provider: PriceProviderId;
  state: ProviderState;
  latencyMs?: number;
  failureCategory?: ProviderFailureCategory;
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
  warningCategories: WarningCategoryCounts;
  acceptedMatchMethods: MatchMethodCounts;
  reviewMatchMethods: MatchMethodCounts;
  enrichmentFallback: boolean;
  providers: ProviderDiagnostic[];
}

export interface RequestRejectedDiagnostic {
  type: "request_rejected";
  requestId: string;
  route: string;
  status: 400 | 404 | 413 | 415 | 503;
  reason:
    | "invalid_request"
    | "invalid_json"
    | "payload_too_large"
    | "unsupported_media_type"
    | "not_found"
    | "server_busy";
  durationMs: number;
}

export interface ProviderCacheDiagnostic extends ProviderCacheEvent {
  type: "provider_cache";
}

export interface ProviderFanoutDiagnostic extends ProviderFanoutEvent {
  type: "provider_fanout";
}

export interface ProviderCacheMetricsSnapshot {
  source: ProviderCacheSource;
  outcomes: Record<ProviderCacheOutcome, number>;
  lookupCount: number;
  hitRate: number;
}

export interface ProviderFanoutMetricsSnapshot {
  source: ProviderFanoutSource;
  reports: number;
  attemptedCalls: number;
  succeededCalls: number;
  failedCalls: number;
  callsPerReport: {
    average: number;
    max: number;
  };
  latency: {
    averageMs: number;
    maxMs: number;
  };
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
  failureCategories: Partial<Record<ProviderFailureCategory, number>>;
}

export interface OperationalMetricsSnapshot {
  type: "metrics_snapshot";
  sampleCount: number;
  compareCompleted: number;
  requestRejected: number;
  rejectionReasons: Partial<Record<RequestRejectedDiagnostic["reason"], number>>;
  offerCount: number;
  warningCount: number;
  warningCategories: WarningCategoryCounts;
  acceptedMatchMethods: MatchMethodCounts;
  reviewMatchMethods: MatchMethodCounts;
  enrichmentFallbackCount: number;
  providerCaches: ProviderCacheMetricsSnapshot[];
  providerFanouts: ProviderFanoutMetricsSnapshot[];
  providers: ProviderMetricsSnapshot[];
}

export type PriceLensDiagnosticEvent =
  | CompareCompletedDiagnostic
  | RequestRejectedDiagnostic
  | ProviderCacheDiagnostic
  | ProviderFanoutDiagnostic
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
  const rejectionReasons = new Map<RequestRejectedDiagnostic["reason"], number>();
  const warningCategories = new Map<ComparisonWarningCategory, number>();
  const acceptedMatchMethods = new Map<MatchMethod, number>();
  const reviewMatchMethods = new Map<MatchMethod, number>();
  const cacheMetrics = new Map<
    ProviderCacheSource,
    Record<ProviderCacheOutcome, number>
  >();
  const fanoutMetrics = new Map<
    ProviderFanoutSource,
    {
      reports: number;
      attemptedCalls: number;
      succeededCalls: number;
      failedCalls: number;
      maxCallsPerReport: number;
      latencyTotalMs: number;
      latencyMaxMs: number;
    }
  >();
  const providerMetrics = new Map<
    PriceProviderId,
    {
      observations: number;
      stateCounts: Map<ProviderState, number>;
      latencyCount: number;
      latencyTotalMs: number;
      latencyMaxMs: number;
      reviewCandidateCount: number;
      failureCategories: Map<ProviderFailureCategory, number>;
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
      warningCategories: Object.fromEntries(warningCategories),
      acceptedMatchMethods: Object.fromEntries(acceptedMatchMethods),
      reviewMatchMethods: Object.fromEntries(reviewMatchMethods),
      enrichmentFallbackCount,
      providerCaches: [...cacheMetrics.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, outcomes]) => {
          const lookupCount = outcomes.hit + outcomes.miss + outcomes.coalesced;
          const resolvedLookups = outcomes.hit + outcomes.miss;
          return {
            source,
            outcomes: {...outcomes},
            lookupCount,
            hitRate:
              resolvedLookups === 0
                ? 0
                : roundMetric(outcomes.hit / resolvedLookups)
          };
        }),
      providerFanouts: [...fanoutMetrics.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([source, metrics]) => ({
          source,
          reports: metrics.reports,
          attemptedCalls: metrics.attemptedCalls,
          succeededCalls: metrics.succeededCalls,
          failedCalls: metrics.failedCalls,
          callsPerReport: {
            average:
              metrics.reports === 0
                ? 0
                : roundMetric(metrics.attemptedCalls / metrics.reports),
            max: metrics.maxCallsPerReport
          },
          latency: {
            averageMs:
              metrics.reports === 0
                ? 0
                : roundMetric(metrics.latencyTotalMs / metrics.reports),
            maxMs: metrics.latencyMaxMs
          }
        })),
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
          reviewCandidateCount: metrics.reviewCandidateCount,
          failureCategories: Object.fromEntries(metrics.failureCategories)
        }))
    };
  }

  const sink: PriceLensDiagnosticSink = (event) => {
    if (event.type === "metrics_snapshot") {
      downstream(event);
      return;
    }

    if (event.type === "provider_cache") {
      const current = cacheMetrics.get(event.source) ?? {
        hit: 0,
        miss: 0,
        coalesced: 0
      };
      current[event.outcome] += 1;
      cacheMetrics.set(event.source, current);
      return;
    }

    if (event.type === "provider_fanout") {
      if (
        !Number.isInteger(event.attempted) ||
        !Number.isInteger(event.succeeded) ||
        !Number.isInteger(event.failed) ||
        event.attempted < 0 ||
        event.succeeded < 0 ||
        event.failed < 0 ||
        event.succeeded + event.failed !== event.attempted ||
        !Number.isFinite(event.durationMs) ||
        event.durationMs < 0
      ) {
        return;
      }

      const current = fanoutMetrics.get(event.source) ?? {
        reports: 0,
        attemptedCalls: 0,
        succeededCalls: 0,
        failedCalls: 0,
        maxCallsPerReport: 0,
        latencyTotalMs: 0,
        latencyMaxMs: 0
      };
      current.reports += 1;
      current.attemptedCalls += event.attempted;
      current.succeededCalls += event.succeeded;
      current.failedCalls += event.failed;
      current.maxCallsPerReport = Math.max(
        current.maxCallsPerReport,
        event.attempted
      );
      current.latencyTotalMs += event.durationMs;
      current.latencyMaxMs = Math.max(
        current.latencyMaxMs,
        event.durationMs
      );
      fanoutMetrics.set(event.source, current);
      return;
    }

    sampleCount += 1;

    if (event.type === "request_rejected") {
      requestRejected += 1;
      incrementMap(rejectionReasons, event.reason, 1);
    } else {
      compareCompleted += 1;
      offerCount += event.offerCount;
      warningCount += event.warningCount;
      if (event.enrichmentFallback) enrichmentFallbackCount += 1;

      incrementFromRecord(warningCategories, event.warningCategories);
      incrementFromRecord(acceptedMatchMethods, event.acceptedMatchMethods);
      incrementFromRecord(reviewMatchMethods, event.reviewMatchMethods);

      for (const provider of event.providers) {
        const current = providerMetrics.get(provider.provider) ?? {
          observations: 0,
          stateCounts: new Map<ProviderState, number>(),
          latencyCount: 0,
          latencyTotalMs: 0,
          latencyMaxMs: 0,
          reviewCandidateCount: 0,
          failureCategories: new Map<ProviderFailureCategory, number>()
        };

        current.observations += 1;
        incrementMap(current.stateCounts, provider.state, 1);
        current.reviewCandidateCount += provider.reviewCandidateCount;
        if (provider.failureCategory !== undefined) {
          incrementMap(
            current.failureCategories,
            provider.failureCategory,
            1
          );
        }

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

function incrementFromRecord<Key extends string>(
  target: Map<Key, number>,
  values: Partial<Record<Key, number>>
): void {
  for (const [key, value] of Object.entries(values) as Array<[Key, number]>) {
    if (!Number.isFinite(value) || value <= 0) continue;
    incrementMap(target, key, value);
  }
}

function incrementMap<Key>(
  target: Map<Key, number>,
  key: Key,
  increment: number
): void {
  target.set(key, (target.get(key) ?? 0) + increment);
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
