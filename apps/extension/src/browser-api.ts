import type {StorageAreaLike} from "./privacy-consent.js";

export interface RuntimeErrorSource {
  readonly lastError?: {message?: string};
}

export interface CallbackStorageArea {
  get(
    key: string,
    callback: (items: Record<string, unknown>) => void
  ): void;
  set(items: Record<string, unknown>, callback: () => void): void;
  remove(key: string, callback: () => void): void;
}

export interface CallbackRuntime extends RuntimeErrorSource {
  sendMessage(
    message: unknown,
    callback: (response: unknown) => void
  ): void;
}

export function createCallbackStorageAdapter(
  storage: CallbackStorageArea,
  runtime: RuntimeErrorSource
): StorageAreaLike {
  return {
    get(key) {
      return new Promise((resolve, reject) => {
        storage.get(key, (items) => {
          const error = readRuntimeError(runtime);
          if (error) {
            reject(error);
            return;
          }
          resolve(items);
        });
      });
    },

    set(items) {
      return new Promise((resolve, reject) => {
        storage.set(items, () => {
          const error = readRuntimeError(runtime);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },

    remove(key) {
      return new Promise((resolve, reject) => {
        storage.remove(key, () => {
          const error = readRuntimeError(runtime);
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

export function sendCallbackRuntimeMessage<TResponse>(
  runtime: CallbackRuntime,
  message: unknown
): Promise<TResponse | undefined> {
  return new Promise((resolve, reject) => {
    runtime.sendMessage(message, (response) => {
      const error = readRuntimeError(runtime);
      if (error) {
        reject(error);
        return;
      }
      resolve(response as TResponse | undefined);
    });
  });
}

function readRuntimeError(runtime: RuntimeErrorSource): Error | undefined {
  const message = runtime.lastError?.message?.trim();
  return message ? new Error(message) : undefined;
}
