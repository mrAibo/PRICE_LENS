import {once} from "node:events";
import {createServer} from "node:http";
import {describe, expect, it, vi} from "vitest";
import {createGracefulShutdownHandler} from "../src/shutdown.js";

describe("graceful shutdown", () => {
  it("closes the listener and exits successfully", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const exit = vi.fn();
    const shutdown = createGracefulShutdownHandler(server, {
      timeoutMs: 1_000,
      exit
    });

    shutdown();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(server.listening).toBe(false);
  });

  it("is idempotent when multiple termination signals arrive", async () => {
    const server = createServer((_request, response) => {
      response.end("ok");
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");

    const exit = vi.fn();
    const closeSpy = vi.spyOn(server, "close");
    const shutdown = createGracefulShutdownHandler(server, {
      timeoutMs: 1_000,
      exit
    });

    shutdown();
    shutdown();

    await vi.waitFor(() => {
      expect(exit).toHaveBeenCalledWith(0);
    });
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
