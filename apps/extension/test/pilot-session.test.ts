import {describe, expect, it} from "vitest";
import {
  PILOT_SESSION_KEY,
  createPilotSessionStore,
  parsePilotSession,
  toPilotAuthStatus
} from "../src/pilot-session.js";
import type {StorageAreaLike} from "../src/privacy-consent.js";

function memoryStorage(initial: Record<string, unknown> = {}): {
  storage: StorageAreaLike;
  values: Record<string, unknown>;
} {
  const values = {...initial};
  return {
    values,
    storage: {
      async get(key) {
        return {[key]: values[key]};
      },
      async set(items) {
        Object.assign(values, items);
      },
      async remove(key) {
        delete values[key];
      }
    }
  };
}

const validSession = {
  sessionToken:
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.signature_value_1234567890",
  expiresAt: "2026-10-04T07:15:00.000Z",
  tier: "pilot" as const
};

describe("pilot session storage", () => {
  it("stores and restores only a still-valid short-lived session", async () => {
    const memory = memoryStorage();
    const store = createPilotSessionStore(
      memory.storage,
      () => Date.parse("2026-10-04T07:00:00.000Z")
    );

    await store.setSession(validSession);

    expect(memory.values[PILOT_SESSION_KEY]).toEqual(validSession);
    await expect(store.getValidSession()).resolves.toEqual(validSession);
    expect(toPilotAuthStatus(true, validSession)).toEqual({
      enabled: true,
      signedIn: true,
      tier: "pilot",
      expiresAt: "2026-10-04T07:15:00.000Z"
    });
  });

  it("clears expired sessions instead of returning a bearer token", async () => {
    const memory = memoryStorage({
      [PILOT_SESSION_KEY]: validSession
    });
    const store = createPilotSessionStore(
      memory.storage,
      () => Date.parse("2026-10-04T07:20:00.000Z")
    );

    await expect(store.getValidSession()).resolves.toBeUndefined();
    expect(memory.values[PILOT_SESSION_KEY]).toBeUndefined();
  });

  it("clears malformed stored sessions and rejects malformed writes", async () => {
    const memory = memoryStorage({
      [PILOT_SESSION_KEY]: {
        sessionToken: "not-a-session",
        expiresAt: "never",
        tier: "admin"
      }
    });
    const store = createPilotSessionStore(
      memory.storage,
      () => Date.parse("2026-10-04T07:00:00.000Z")
    );

    await expect(store.getValidSession()).resolves.toBeUndefined();
    expect(memory.values[PILOT_SESSION_KEY]).toBeUndefined();
    await expect(
      store.setSession({
        ...validSession,
        sessionToken: "bad"
      })
    ).rejects.toThrow("invalid pilot session");
  });

  it("accepts only the server session tiers used by PriceLens", () => {
    expect(parsePilotSession(validSession)?.tier).toBe("pilot");
    expect(
      parsePilotSession({...validSession, tier: "anonymous"})
    ).toBeUndefined();
    expect(toPilotAuthStatus(false, validSession)).toEqual({
      enabled: false,
      signedIn: false
    });
  });
});
