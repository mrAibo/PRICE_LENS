import {
  createHmac,
  randomUUID,
  timingSafeEqual
} from "node:crypto";
import type {IncomingMessage} from "node:http";
import type {ProviderAccessContext, PriceLensAccessTier} from "./provider-access.js";

type FetchLike = typeof fetch;
type JsonRecord = Record<string, unknown>;

const GOOGLE_USERINFO_URL =
  "https://openidconnect.googleapis.com/v1/userinfo";
const SESSION_ISSUER = "price-lens";
const SESSION_AUDIENCE = "price-lens-api";
const SESSION_VERSION = 1;

export interface PriceLensSessionExchange {
  sessionToken: string;
  expiresAt: string;
  tier: PriceLensAccessTier;
}

export interface SessionAuthOptions {
  signingSecret: string;
  subjectTiers?: ReadonlyMap<string, PriceLensAccessTier>;
  sessionTtlSeconds?: number;
  googleVerifyTimeoutMs?: number;
  fetchImpl?: FetchLike;
  now?: () => number;
}

interface SessionClaims {
  v: number;
  iss: string;
  aud: string;
  sub: string;
  iat: number;
  exp: number;
  jti: string;
}

export class PriceLensSessionAuth {
  private readonly signingSecret: Buffer;
  private readonly subjectTiers: ReadonlyMap<string, PriceLensAccessTier>;
  private readonly sessionTtlSeconds: number;
  private readonly googleVerifyTimeoutMs: number;
  private readonly fetchImpl: FetchLike;
  private readonly now: () => number;

  constructor(options: SessionAuthOptions) {
    const signingSecret = options.signingSecret.trim();
    if (Buffer.byteLength(signingSecret, "utf8") < 32) {
      throw new Error(
        "PRICE_LENS_SESSION_SIGNING_SECRET must contain at least 32 UTF-8 bytes."
      );
    }

    this.signingSecret = Buffer.from(signingSecret, "utf8");
    this.subjectTiers = options.subjectTiers ?? new Map();
    this.sessionTtlSeconds = validateIntegerRange(
      options.sessionTtlSeconds ?? 900,
      60,
      3600,
      "PriceLens session TTL"
    );
    this.googleVerifyTimeoutMs = validateIntegerRange(
      options.googleVerifyTimeoutMs ?? 3000,
      250,
      15_000,
      "Google identity verification timeout"
    );
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async exchangeGoogleAccessToken(
    googleAccessToken: string
  ): Promise<PriceLensSessionExchange> {
    const subject = await this.verifyGoogleAccessToken(googleAccessToken);
    const tier = this.resolveTier(subject);
    const issuedAt = Math.floor(this.now() / 1000);
    const expiresAt = issuedAt + this.sessionTtlSeconds;

    return {
      sessionToken: this.signSession({
        v: SESSION_VERSION,
        iss: SESSION_ISSUER,
        aud: SESSION_AUDIENCE,
        sub: subject,
        iat: issuedAt,
        exp: expiresAt,
        jti: randomUUID()
      }),
      expiresAt: new Date(expiresAt * 1000).toISOString(),
      tier
    };
  }

  resolveProviderAccess(request: IncomingMessage): ProviderAccessContext {
    const token = readBearerToken(request.headers.authorization);
    if (!token) {
      return {
        tier: "anonymous",
        restrictedProviders: ["idealo", "geizhals"]
      };
    }

    const claims = this.verifySession(token);
    if (!claims) {
      return {
        tier: "anonymous",
        restrictedProviders: ["idealo", "geizhals"]
      };
    }

    const tier = this.resolveTier(claims.sub);
    return {
      tier,
      restrictedProviders:
        tier === "pilot" || tier === "pro" || tier === "admin"
          ? []
          : ["idealo", "geizhals"]
    };
  }

  verifySession(token: string): SessionClaims | undefined {
    const parts = token.split(".");
    if (parts.length !== 3) return undefined;
    const [headerPart, payloadPart, signaturePart] = parts;
    if (!headerPart || !payloadPart || !signaturePart) return undefined;

    const expectedSignature = signHmac(
      this.signingSecret,
      `${headerPart}.${payloadPart}`
    );
    const receivedSignature = decodeBase64Url(signaturePart);
    if (
      !receivedSignature ||
      receivedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(receivedSignature, expectedSignature)
    ) {
      return undefined;
    }

    const header = parseBase64UrlJson(headerPart);
    if (
      !header ||
      header.alg !== "HS256" ||
      header.typ !== "JWT"
    ) {
      return undefined;
    }

    const claims = parseSessionClaims(payloadPart);
    if (!claims) return undefined;

    const nowSeconds = Math.floor(this.now() / 1000);
    if (
      claims.v !== SESSION_VERSION ||
      claims.iss !== SESSION_ISSUER ||
      claims.aud !== SESSION_AUDIENCE ||
      claims.iat > nowSeconds + 30 ||
      claims.exp <= nowSeconds ||
      claims.exp - claims.iat > 3600
    ) {
      return undefined;
    }

    return claims;
  }

  private resolveTier(subject: string): PriceLensAccessTier {
    const configured = this.subjectTiers.get(subject);
    if (
      configured === "pilot" ||
      configured === "pro" ||
      configured === "admin"
    ) {
      return configured;
    }
    return "free";
  }

  private async verifyGoogleAccessToken(accessToken: string): Promise<string> {
    const token = accessToken.trim();
    if (
      token.length < 16 ||
      token.length > 8192 ||
      /\s/.test(token)
    ) {
      throw new Error("Google authentication failed.");
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.googleVerifyTimeoutMs
    );

    try {
      const response = await this.fetchImpl(GOOGLE_USERINFO_URL, {
        method: "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: "application/json"
        },
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error("Google authentication failed.");
      }

      const payload: unknown = await response.json();
      const record = isRecord(payload) ? payload : undefined;
      const subject =
        record && typeof record.sub === "string"
          ? record.sub.trim()
          : "";

      if (!isValidGoogleSubject(subject)) {
        throw new Error("Google authentication failed.");
      }

      return subject;
    } catch (error) {
      if (controller.signal.aborted) {
        throw new Error("Google authentication timed out.");
      }
      if (error instanceof Error && error.message.startsWith("Google authentication")) {
        throw error;
      }
      throw new Error("Google authentication failed.");
    } finally {
      clearTimeout(timer);
    }
  }

  private signSession(claims: SessionClaims): string {
    const header = encodeJsonBase64Url({alg: "HS256", typ: "JWT"});
    const payload = encodeJsonBase64Url(claims);
    const signingInput = `${header}.${payload}`;
    const signature = signHmac(this.signingSecret, signingInput)
      .toString("base64url");
    return `${signingInput}.${signature}`;
  }
}

export function createSessionAuthFromEnv(
  env: NodeJS.ProcessEnv = process.env,
  runtimeOptions: Pick<SessionAuthOptions, "fetchImpl" | "now"> = {}
): PriceLensSessionAuth | undefined {
  if (env.PRICE_LENS_SESSION_AUTH_ENABLED !== "1") return undefined;

  const signingSecret = env.PRICE_LENS_SESSION_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    throw new Error(
      "PRICE_LENS_SESSION_AUTH_ENABLED=1 requires PRICE_LENS_SESSION_SIGNING_SECRET."
    );
  }

  return new PriceLensSessionAuth({
    signingSecret,
    subjectTiers: parseSubjectTiers(
      env.PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON
    ),
    sessionTtlSeconds: parseIntegerEnv(
      env.PRICE_LENS_SESSION_TTL_SECONDS,
      900,
      60,
      3600,
      "PRICE_LENS_SESSION_TTL_SECONDS"
    ),
    googleVerifyTimeoutMs: parseIntegerEnv(
      env.PRICE_LENS_GOOGLE_VERIFY_TIMEOUT_MS,
      3000,
      250,
      15_000,
      "PRICE_LENS_GOOGLE_VERIFY_TIMEOUT_MS"
    ),
    ...runtimeOptions
  });
}

export function parseSubjectTiers(
  raw: string | undefined
): ReadonlyMap<string, PriceLensAccessTier> {
  if (!raw?.trim()) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      "PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON must be valid JSON."
    );
  }

  if (!isRecord(parsed)) {
    throw new Error(
      "PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON must be a JSON object."
    );
  }

  const tiers = new Map<string, PriceLensAccessTier>();
  for (const [subject, value] of Object.entries(parsed)) {
    if (!isValidGoogleSubject(subject)) {
      throw new Error(
        "PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON contains an invalid Google subject."
      );
    }
    if (value !== "pilot" && value !== "pro" && value !== "admin") {
      throw new Error(
        "PRICE_LENS_GOOGLE_SUBJECT_TIERS_JSON values must be pilot, pro, or admin."
      );
    }
    tiers.set(subject, value);
  }

  return tiers;
}

function readBearerToken(
  authorization: string | undefined
): string | undefined {
  if (!authorization) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(
    authorization
  );
  return match?.[1];
}

function parseSessionClaims(encoded: string): SessionClaims | undefined {
  const value = parseBase64UrlJson(encoded);
  if (!value) return undefined;

  if (
    typeof value.v !== "number" ||
    typeof value.iss !== "string" ||
    typeof value.aud !== "string" ||
    typeof value.sub !== "string" ||
    typeof value.iat !== "number" ||
    typeof value.exp !== "number" ||
    typeof value.jti !== "string" ||
    !Number.isSafeInteger(value.v) ||
    !Number.isSafeInteger(value.iat) ||
    !Number.isSafeInteger(value.exp) ||
    !isValidGoogleSubject(value.sub) ||
    !/^[0-9a-f-]{36}$/i.test(value.jti)
  ) {
    return undefined;
  }

  return {
    v: value.v,
    iss: value.iss,
    aud: value.aud,
    sub: value.sub,
    iat: value.iat,
    exp: value.exp,
    jti: value.jti
  };
}

function parseBase64UrlJson(
  encoded: string
): JsonRecord | undefined {
  const decoded = decodeBase64Url(encoded);
  if (!decoded) return undefined;

  try {
    const parsed: unknown = JSON.parse(decoded.toString("utf8"));
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function decodeBase64Url(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined;
  try {
    return Buffer.from(value, "base64url");
  } catch {
    return undefined;
  }
}

function encodeJsonBase64Url(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function signHmac(secret: Buffer, input: string): Buffer {
  return createHmac("sha256", secret).update(input, "utf8").digest();
}

function isValidGoogleSubject(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= 255 &&
    /^[A-Za-z0-9._:-]+$/.test(value)
  );
}

function parseIntegerEnv(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (!raw?.trim()) return fallback;
  if (!/^\d+$/.test(raw.trim())) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return validateIntegerRange(
    Number(raw.trim()),
    minimum,
    maximum,
    name
  );
}

function validateIntegerRange(
  value: number,
  minimum: number,
  maximum: number,
  name: string
): number {
  if (
    !Number.isSafeInteger(value) ||
    value < minimum ||
    value > maximum
  ) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`
    );
  }
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
