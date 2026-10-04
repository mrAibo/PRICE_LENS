export interface GoogleAuthTokenResult {
  token?: string;
}

export interface GoogleIdentityApi {
  getAuthToken(details: {
    interactive: boolean;
    scopes: string[];
  }): Promise<GoogleAuthTokenResult>;
}

export async function acquireGooglePilotAccessToken(
  identity: GoogleIdentityApi
): Promise<string> {
  const auth = await identity.getAuthToken({
    interactive: true,
    scopes: ["openid"]
  });
  const accessToken = auth.token?.trim();

  if (
    !accessToken ||
    accessToken.length < 16 ||
    accessToken.length > 8192 ||
    /\s/.test(accessToken)
  ) {
    throw new Error("Google sign-in did not return a valid access token.");
  }

  return accessToken;
}
