import {describe, expect, it, vi} from "vitest";
import {
  createAggregatingDiagnosticSink,
  createJsonLineDiagnosticSink
} from "../src/diagnostics.js";

describe("structured diagnostics", () => {
  it("serializes a bounded JSON line without product or credential fields", () => {
    const write = vi.fn<(line: string) => void>();
    const sink = createJsonLineDiagnosticSink(
      write,
      () => "2026-10-02T16:30:00.000Z"
    );

    sink({
      type: "compare_completed",
      requestId: "req-1",
      route: "/v1/compare",
      status: 200,
      durationMs: 42,
      offerCount: 1,
      warningCount: 0,
      warningCategories: {},
      acceptedMatchMethods: {gtin: 1},
      reviewMatchMethods: {},
      enrichmentFallback: false,
      providers: [
        {
          provider: "amazon",
          state: "ok",
          latencyMs: 12,
          reviewCandidateCount: 0
        }
      ]
    });

    expect(write).toHaveBeenCalledTimes(1);
    const line = write.mock.calls[0]![0];
    expect(line.endsWith("\n")).toBe(true);

    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed).toMatchObject({
      timestamp: "2026-10-02T16:30:00.000Z",
      service: "price-lens-api",
      type: "compare_completed",
      requestId: "req-1"
    });
    expect(line).not.toMatch(/authorization|cookie|credential|secret|title|itemId|url/i);
  });


  it("aggregates provider latency, states and request rejection reasons", () => {
    const downstream = vi.fn();
    const aggregator = createAggregatingDiagnosticSink(downstream, 3);

    aggregator.sink({
      type: "compare_completed",
      requestId: "req-1",
      route: "/v1/compare",
      status: 200,
      durationMs: 40,
      offerCount: 1,
      warningCount: 0,
      warningCategories: {},
      acceptedMatchMethods: {gtin: 1},
      reviewMatchMethods: {},
      enrichmentFallback: false,
      providers: [
        {
          provider: "amazon",
          state: "ok",
          latencyMs: 12,
          reviewCandidateCount: 0
        }
      ]
    });

    aggregator.sink({
      type: "compare_completed",
      requestId: "req-2",
      route: "/v1/compare",
      status: 200,
      durationMs: 60,
      offerCount: 0,
      warningCount: 1,
      warningCategories: {
        enrichment_fallback: 1
      },
      acceptedMatchMethods: {},
      reviewMatchMethods: {fuzzy: 2},
      enrichmentFallback: true,
      providers: [
        {
          provider: "amazon",
          state: "error",
          latencyMs: 30,
          reviewCandidateCount: 2
        }
      ]
    });

    aggregator.sink({
      type: "request_rejected",
      requestId: "req-3",
      route: "/v1/compare",
      status: 503,
      reason: "server_busy",
      durationMs: 1
    });

    expect(aggregator.snapshot()).toEqual({
      type: "metrics_snapshot",
      sampleCount: 3,
      compareCompleted: 2,
      requestRejected: 1,
      rejectionReasons: {
        server_busy: 1
      },
      offerCount: 1,
      warningCount: 1,
      warningCategories: {
        enrichment_fallback: 1
      },
      acceptedMatchMethods: {
        gtin: 1
      },
      reviewMatchMethods: {
        fuzzy: 2
      },
      enrichmentFallbackCount: 1,
      providerCaches: [],
      providers: [
        {
          provider: "amazon",
          observations: 2,
          stateCounts: {
            ok: 1,
            error: 1
          },
          latency: {
            count: 2,
            averageMs: 21,
            maxMs: 30
          },
          reviewCandidateCount: 2
        }
      ]
    });

    expect(downstream).toHaveBeenCalledTimes(4);
    expect(downstream.mock.calls[3]?.[0]).toEqual(aggregator.snapshot());

    const serialized = JSON.stringify(aggregator.snapshot());
    expect(serialized).not.toMatch(
      /requestId|route|title|itemId|url|credential|secret/i
    );
  });

  it("aggregates cache hit/miss/coalesced events without logging cache keys", () => {
    const downstream = vi.fn();
    const aggregator = createAggregatingDiagnosticSink(downstream, 100);

    aggregator.sink({
      type: "provider_cache",
      source: "ebay",
      outcome: "miss"
    });
    aggregator.sink({
      type: "provider_cache",
      source: "ebay",
      outcome: "hit"
    });
    aggregator.sink({
      type: "provider_cache",
      source: "ebay",
      outcome: "coalesced"
    });
    aggregator.sink({
      type: "provider_cache",
      source: "amazon",
      outcome: "miss"
    });

    expect(downstream).not.toHaveBeenCalled();
    expect(aggregator.snapshot().providerCaches).toEqual([
      {
        source: "amazon",
        outcomes: {hit: 0, miss: 1, coalesced: 0},
        lookupCount: 1,
        hitRate: 0
      },
      {
        source: "ebay",
        outcomes: {hit: 1, miss: 1, coalesced: 1},
        lookupCount: 3,
        hitRate: 0.5
      }
    ]);

    const serialized = JSON.stringify(aggregator.snapshot().providerCaches);
    expect(serialized).not.toMatch(/key|item|title|url|query|term/i);
  });

  it.each([0, -1, 1.5])(
    "rejects invalid metrics emission interval %s",
    (emitEvery) => {
      expect(() =>
        createAggregatingDiagnosticSink(() => {}, emitEvery)
      ).toThrow("emitEvery must be a positive integer");
    }
  );
});
