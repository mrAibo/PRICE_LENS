import {
  exchangeGoogleSession,
  requestComparison
} from "./api/client.js";
import {createCallbackStorageAdapter} from "./browser-api.js";
import {
  isCompareMessage,
  isPilotAuthStatusMessage,
  isPilotSignInMessage,
  isPilotSignOutMessage,
  type CompareMessage,
  type CompareResponse,
  type PilotAuthResponse
} from "./messages.js";
import {
  createPilotSessionStore,
  toPilotAuthStatus
} from "./pilot-session.js";

declare const __PRICE_LENS_GOOGLE_AUTH_ENABLED__: boolean | undefined;

const googleAuthEnabled =
  typeof __PRICE_LENS_GOOGLE_AUTH_ENABLED__ === "boolean" &&
  __PRICE_LENS_GOOGLE_AUTH_ENABLED__;

const pilotSessionStore = createPilotSessionStore(
  createCallbackStorageAdapter(chrome.storage.session, chrome.runtime)
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (isCompareMessage(message)) {
    void handleComparison(message)
      .then((response) => sendResponse(response))
      .catch((error: unknown) => {
        const response: CompareResponse = {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Comparison request failed."
        };
        sendResponse(response);
      });
    return true;
  }

  if (isPilotAuthStatusMessage(message)) {
    void readPilotAuthStatus()
      .then((status) => {
        const response: PilotAuthResponse = {ok: true, status};
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const response: PilotAuthResponse = {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Pilot authentication status is unavailable."
        };
        sendResponse(response);
      });
    return true;
  }

  if (isPilotSignInMessage(message)) {
    void signInPilot()
      .then((status) => {
        const response: PilotAuthResponse = {ok: true, status};
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const response: PilotAuthResponse = {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Pilot sign-in failed."
        };
        sendResponse(response);
      });
    return true;
  }

  if (isPilotSignOutMessage(message)) {
    void pilotSessionStore
      .clearSession()
      .then(() => {
        const response: PilotAuthResponse = {
          ok: true,
          status: toPilotAuthStatus(googleAuthEnabled)
        };
        sendResponse(response);
      })
      .catch((error: unknown) => {
        const response: PilotAuthResponse = {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Pilot sign-out failed."
        };
        sendResponse(response);
      });
    return true;
  }

  return false;
});

async function handleComparison(
  message: CompareMessage
): Promise<CompareResponse> {
  const session = googleAuthEnabled
    ? await pilotSessionStore.getValidSession().catch(() => undefined)
    : undefined;

  const result = await requestComparison(message.listing, {
    destination: message.destination,
    sessionToken: session?.sessionToken
  });
  return {ok: true, result};
}

async function readPilotAuthStatus() {
  if (!googleAuthEnabled) {
    return toPilotAuthStatus(false);
  }

  const session = await pilotSessionStore
    .getValidSession()
    .catch(() => undefined);
  return toPilotAuthStatus(true, session);
}

async function signInPilot() {
  if (!googleAuthEnabled) {
    throw new Error("Pilot Google sign-in is not configured in this build.");
  }
  if (!chrome.identity?.getAuthToken) {
    throw new Error("Chrome identity is unavailable in this browser.");
  }

  const auth = await chrome.identity.getAuthToken({
    interactive: true,
    scopes: ["openid"]
  });
  const accessToken = auth.token?.trim();
  if (!accessToken) {
    throw new Error("Google sign-in did not return an access token.");
  }

  const exchange = await exchangeGoogleSession(accessToken);
  await pilotSessionStore.setSession(exchange);
  return toPilotAuthStatus(true, exchange);
}
