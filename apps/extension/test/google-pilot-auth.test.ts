import {describe, expect, it, vi} from "vitest";
import {
  acquireGooglePilotAccessToken,
  type GoogleIdentityApi
} from "../src/google-pilot-auth.js";

describe("Google pilot authentication", () => {
  it("requests only openid and only through an explicit interactive flow", async () => {
    const getAuthToken = vi.fn(async () => ({
      token: "google-access-token-1234567890"
    }));
    const identity: GoogleIdentityApi = {getAuthToken};

    await expect(
      acquireGooglePilotAccessToken(identity)
    ).resolves.toBe("google-access-token-1234567890");

    expect(getAuthToken).toHaveBeenCalledWith({
      interactive: true,
      scopes: ["openid"]
    });
  });

  it("rejects missing or malformed access tokens", async () => {
    await expect(
      acquireGooglePilotAccessToken({
        async getAuthToken() {
          return {};
        }
      })
    ).rejects.toThrow("valid access token");

    await expect(
      acquireGooglePilotAccessToken({
        async getAuthToken() {
          return {token: "contains whitespace token"};
        }
      })
    ).rejects.toThrow("valid access token");
  });
});
