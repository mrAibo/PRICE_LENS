import type {
  PriceProviderId,
  ProviderState
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

export type PriceLensDiagnosticEvent =
  | CompareCompletedDiagnostic
  | RequestRejectedDiagnostic;

export type PriceLensDiagnosticSink = (
  event: PriceLensDiagnosticEvent
) => void;

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
