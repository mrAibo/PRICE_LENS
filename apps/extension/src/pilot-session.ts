import type {StorageAreaLike} from "./privacy-consent.js";

export const PILOT_SESSION_KEY = "priceLensPilotSession.v1";

export type PilotAccessTier = "free" | "pilot" | "pro" | "admin";

export interface PilotSession {
  sessionToken: string;
  expiresAt: string;
  tier: PilotAccessTier;
}

export interface PilotAuthStatus {
  enabled: boolean;
  signedIn: boolean;
  tier?: PilotAccessTier;
  expiresAt?: string;
}

export interface PilotSessionStore {
  getValidSession(): Promise<PilotSession | undefined>;
  setSession(session: PilotSession): Promise<void>;
  clearSession(): Promise<void>;
}

export function createPilotSessionStore(
  storage: StorageAreaLike,
  now: () => number = Date.now
): PilotSessionStore {
  return {
    async getValidSession() {
      const values = await storage.get(PILOT_SESSION_KEY);
      const session = parsePilotSession(values[PILOT_SESSION_KEY]);
      if (!session) {
        if (values[PILOT_SESSION_KEY] !== undefined) {
          await storage.remove(PILOT_SESSION_KEY);
        }
        return undefined;
      }

      const expiresAt = Date.parse(session.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now() + 5_000) {
        await storage.remove(PILOT_SESSION_KEY);
        return undefined;
      }
      return session;
    },

    async setSession(session) {
      const validated = parsePilotSession(session);
      if (!validated) {
        throw new Error("PriceLens returned an invalid pilot session.");
      }
      const expiresAt = Date.parse(validated.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now() + 5_000) {
        throw new Error("PriceLens returned an expired pilot session.");
      }
      await storage.set({[PILOT_SESSION_KEY]: validated});
    },

    async clearSession() {
      await storage.remove(PILOT_SESSION_KEY);
    }
  };
}

export function toPilotAuthStatus(
  enabled: boolean,
  session?: PilotSession
): PilotAuthStatus {
  if (!enabled) return {enabled: false, signedIn: false};
  if (!session) return {enabled: true, signedIn: false};
  return {
    enabled: true,
    signedIn: true,
    tier: session.tier,
    expiresAt: session.expiresAt
  };
}

export function parsePilotSession(value: unknown): PilotSession | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Partial<PilotSession>;

  if (
    typeof record.sessionToken !== "string" ||
    record.sessionToken.length < 32 ||
    record.sessionToken.length > 8192 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(
      record.sessionToken
    ) ||
    typeof record.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(record.expiresAt)) ||
    !isPilotAccessTier(record.tier)
  ) {
    return undefined;
  }

  return {
    sessionToken: record.sessionToken,
    expiresAt: record.expiresAt,
    tier: record.tier
  };
}

function isPilotAccessTier(value: unknown): value is PilotAccessTier {
  return value === "free" || value === "pilot" || value === "pro" || value === "admin";
}
