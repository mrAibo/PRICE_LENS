import {describe, expect, it} from "vitest";
import {
  createCallbackStorageAdapter,
  sendCallbackRuntimeMessage,
  type CallbackRuntime,
  type CallbackStorageArea,
  type RuntimeErrorSource
} from "../src/browser-api.js";

describe("cross-browser callback adapters", () => {
  it("wraps callback storage APIs in promises", async () => {
    const values: Record<string, unknown> = {};
    const runtime: RuntimeErrorSource = {};
    const storage: CallbackStorageArea = {
      get(key, callback) {
        callback({[key]: values[key]});
      },
      set(items, callback) {
        Object.assign(values, items);
        callback();
      },
      remove(key, callback) {
        delete values[key];
        callback();
      }
    };

    const adapter = createCallbackStorageAdapter(storage, runtime);

    await adapter.set({enabled: true});
    await expect(adapter.get("enabled")).resolves.toEqual({enabled: true});
    await adapter.remove("enabled");
    await expect(adapter.get("enabled")).resolves.toEqual({enabled: undefined});
  });

  it("propagates extension runtime errors from storage callbacks", async () => {
    const runtime: RuntimeErrorSource = {
      lastError: {message: "storage unavailable"}
    };
    const storage: CallbackStorageArea = {
      get(_key, callback) {
        callback({});
      },
      set(_items, callback) {
        callback();
      },
      remove(_key, callback) {
        callback();
      }
    };

    const adapter = createCallbackStorageAdapter(storage, runtime);

    await expect(adapter.get("enabled")).rejects.toThrow("storage unavailable");
    await expect(adapter.set({enabled: true})).rejects.toThrow("storage unavailable");
    await expect(adapter.remove("enabled")).rejects.toThrow("storage unavailable");
  });

  it("wraps callback runtime messaging in a promise", async () => {
    const runtime: CallbackRuntime = {
      sendMessage(message, callback) {
        callback({echo: message});
      }
    };

    await expect(
      sendCallbackRuntimeMessage<{echo: unknown}>(runtime, {type: "PING"})
    ).resolves.toEqual({echo: {type: "PING"}});
  });

  it("rejects runtime messaging when lastError is set", async () => {
    const runtime: CallbackRuntime = {
      lastError: {message: "receiver unavailable"},
      sendMessage(_message, callback) {
        callback(undefined);
      }
    };

    await expect(
      sendCallbackRuntimeMessage(runtime, {type: "PING"})
    ).rejects.toThrow("receiver unavailable");
  });
});
