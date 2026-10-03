import assert from "node:assert/strict";
import test from "node:test";
import {
  probeProductionOrigin,
  validateProductionOrigin
} from "./release-preflight.mjs";

test("accepts a real-looking HTTPS production origin", () => {
  assert.equal(
    validateProductionOrigin("https://api.pricelens.de"),
    "https://api.pricelens.de"
  );
});

test("rejects non-production or unsafe origins", () => {
  const invalidOrigins = [
    "http://api.pricelens.de",
    "https://api.pricelens.invalid",
    "https://api.example.com",
    "https://127.0.0.1",
    "https://localhost",
    "https://api.pricelens.de/path",
    "https://api.pricelens.de?debug=1",
    "https://user:secret@api.pricelens.de",
    "https://api.pricelens.de:8443",
    "https://replace-with-api-domain.de"
  ];

  for (const origin of invalidOrigins) {
    assert.throws(
      () => validateProductionOrigin(origin),
      undefined,
      `expected ${origin} to be rejected`
    );
  }
});

test("probes both readiness and health before release packaging", async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const path = new URL(url).pathname;
    const status = path === "/ready" ? "ready" : "ok";
    return new Response(JSON.stringify({status}), {
      status: 200,
      headers: {"content-type": "application/json"}
    });
  };

  const origin = await probeProductionOrigin("https://api.pricelens.de", {
    fetchImpl,
    timeoutMs: 1000
  });

  assert.equal(origin, "https://api.pricelens.de");
  assert.deepEqual(calls, [
    "https://api.pricelens.de/ready",
    "https://api.pricelens.de/health"
  ]);
});

test("rejects a release endpoint with the wrong readiness payload", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({status: "starting"}), {
      status: 200,
      headers: {"content-type": "application/json"}
    });

  await assert.rejects(
    () =>
      probeProductionOrigin("https://api.pricelens.de", {
        fetchImpl,
        timeoutMs: 1000
      }),
    /unexpected status payload/
  );
});

test("rejects a release endpoint that returns an HTTP error", async () => {
  const fetchImpl = async () =>
    new Response(JSON.stringify({status: "unavailable"}), {
      status: 503,
      headers: {"content-type": "application/json"}
    });

  await assert.rejects(
    () =>
      probeProductionOrigin("https://api.pricelens.de", {
        fetchImpl,
        timeoutMs: 1000
      }),
    /returned HTTP 503/
  );
});
