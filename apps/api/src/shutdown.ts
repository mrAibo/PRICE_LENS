import type {Server} from "node:http";

export interface GracefulShutdownOptions {
  timeoutMs?: number;
  exit?: (code: number) => void;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export function installGracefulShutdown(
  server: Server,
  options: GracefulShutdownOptions = {}
): () => void {
  const shutdown = createGracefulShutdownHandler(server, options);
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  return shutdown;
}

export function createGracefulShutdownHandler(
  server: Server,
  options: GracefulShutdownOptions = {}
): () => void {
  const timeoutMs = options.timeoutMs ?? 9_000;
  const exit = options.exit ?? process.exit;
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  let shuttingDown = false;

  return () => {
    if (shuttingDown) return;
    shuttingDown = true;

    const forceTimer = setTimeoutFn(() => {
      server.closeAllConnections?.();
      exit(1);
    }, timeoutMs);
    forceTimer.unref?.();

    server.close((error) => {
      clearTimeoutFn(forceTimer);
      if (error) {
        exit(1);
        return;
      }
      exit(0);
    });

    server.closeIdleConnections?.();
  };
}
