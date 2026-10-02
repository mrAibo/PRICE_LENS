import {describe, expect, it, vi} from "vitest";
import {createJsonLineDiagnosticSink} from "../src/diagnostics.js";

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
});
