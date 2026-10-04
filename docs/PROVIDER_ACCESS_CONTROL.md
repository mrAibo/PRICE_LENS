# Provider Access Control

Status: **server-side entitlement + opt-in Chrome pilot sign-in implemented; live OAuth/client configuration pending**

Updated: **2026-10-04**

## Product policy

PriceLens must be able to keep a provider implementation present without exposing it
to every user.

Initial policy:

```text
public / anonymous:
  eBay        allowed when configured
  Amazon      allowed when configured and approved
  Idealo      restricted / Private beta
  Geizhals    restricted / Private beta

pilot / pro / admin:
  provider availability is decided by the server-side entitlement resolver
```

This preserves the Idealo/Geizhals integration path for the one- or two-user pilot
without shipping provider credentials or a reusable private key inside the extension.

## Trust boundary

Provider access is **server-owned**.

The comparison request contract contains listing and optional buyer destination data.
It contains no trusted access tier, role or entitlement field.

A browser may send arbitrary extra JSON such as:

```json
{
  "accessTier": "pilot",
  "restrictedProviders": []
}
```

but these fields are not used to grant access.

The API obtains a `ProviderAccessContext` from its own resolver. The default resolver
is the public policy and restricts:

```text
idealo
geizhals
```

before provider orchestration starts.

This means a restricted adapter's `search()` method is never called for a public
request.

## Fail-closed behavior

The access layer follows these invariants:

- missing resolver -> public restrictions;
- resolver exception -> public restrictions;
- malformed resolver context -> public restrictions;
- unknown provider IDs -> public restrictions;
- anonymous/free tiers cannot remove the minimum Idealo/Geizhals restrictions;
- only a server-resolved pilot/pro/admin context can permit those sources.

The provider state returned to the UI is:

```text
restricted
```

rather than `unconfigured` or `error`.

The extension renders restricted sources as:

```text
Private beta sources
Idealo · Geizhals — not available in the public plan yet.
```

No provider request is made merely to render this placeholder.

## Authenticated pilot session foundation

The backend now supports an opt-in Google-to-PriceLens session exchange:

```text
explicit user sign-in
   ↓
short-lived Google OAuth access token
   ↓
POST /v1/session/google
   ↓
Google userinfo verification
   ↓
Google stable subject ("sub")
   ↓
server-side subject → tier map
   ↓
15-minute PriceLens HMAC session
   ↓
Authorization: Bearer <PriceLens session>
   ↓
tier re-resolved on every comparison
```

Important invariants:

- Google access tokens are used only for the sign-in exchange and are never provider credentials;
- entitlement keys use Google's stable `sub`, not email addresses;
- unknown valid Google subjects receive the normal `free` tier;
- the PriceLens session does **not** carry trusted provider entitlements;
- the backend re-resolves the session subject against trusted account data on every comparison;
- removing a subject from the pilot map therefore revokes restricted-provider access immediately,
  even if that user's PriceLens session has not expired yet;
- session lifetime defaults to 900 seconds and is bounded to 60–3600 seconds;
- malformed, tampered, expired or missing sessions fail closed to public restrictions;
- the session exchange response is `Cache-Control: no-store`;
- Google verification has a bounded timeout;
- the Cloud Armor session-exchange rate limit is enforced rather than preview-only.

The trusted pilot map is stored server-side as:

```json
{
  "google-subject-1": "pilot",
  "google-subject-2": "pilot"
}
```

Allowed privileged values are `pilot`, `pro`, and `admin`. The JSON mapping and
the HMAC signing secret are separate pinned Secret Manager versions. Neither belongs in
Terraform variables, GitHub, extension storage, source code or logs.

The browser extension must never contain:

- Idealo credentials;
- Geizhals credentials;
- the PriceLens session-signing secret;
- the Google-subject entitlement map;
- a shared long-lived pilot bearer token;
- a hard-coded "admin" secret;
- provider API secrets.

The Chrome interactive sign-in client is now implemented as a build-time opt-in pilot
capability.

Public Chrome and Firefox builds remain anonymous/free and keep the existing Private
beta placeholder. They contain no OAuth client configuration and request no
`identity` permission.

A Chrome pilot build is enabled only when:

```text
PRICE_LENS_GOOGLE_OAUTH_CLIENT_ID=<chrome-extension-oauth-client>.apps.googleusercontent.com
```

is supplied at build/package time. That generated Chrome manifest adds exactly:

```json
{
  "permissions": ["storage", "identity"],
  "oauth2": {
    "client_id": "...apps.googleusercontent.com",
    "scopes": ["openid"]
  }
}
```

It does not request `identity.email`, profile, contacts or unrelated Google scopes.

The user flow is:

```text
restricted Idealo/Geizhals result
   ↓ explicit "Sign in with Google" click
chrome.identity.getAuthToken({ interactive: true, scopes: ["openid"] })
   ↓
POST /v1/session/google
   ↓
short-lived PriceLens session stored in chrome.storage.session
   ↓
Authorization: Bearer <PriceLens session> on explicit comparisons
```

The Google access token is not written to extension storage. The PriceLens session is
kept in session storage rather than durable local storage, is rejected locally near
expiry, and remains subject to server-side entitlement re-resolution.

Signing out clears the PriceLens session and immediately refreshes the current report
under public restrictions. **Disable PriceLens data sharing** also clears the pilot
session.

Live pilot activation still requires:

1. a stable Chrome extension ID;
2. a Google OAuth client registered for that extension;
3. backend session auth enabled with pinned signing/mapping secrets;
4. the approved pilot Google `sub` values in the server-side entitlement map.

The OAuth client ID is configuration, not a provider credential, but it is still injected
only into the explicit pilot build so the public artifact retains the minimal permission
surface.

## Provider licensing remains separate

Entitlement gating is a product/access-control mechanism. It does not create legal
permission to use a provider.

Idealo and Geizhals remain live-blocked until the applicable publisher agreement,
API/feed contract, display/attribution rules, cache/freshness rules and browser-extension
use are confirmed.

A private pilot or paid provider account does not override those terms.

## Tests

The automated suite verifies:

- restricted providers are skipped before `search()`;
- public API requests return `restricted` status for Idealo/Geizhals;
- a client-supplied fake pilot tier does not change access;
- resolver failures fail closed;
- a server-resolved pilot policy can enable a configured provider;
- Google userinfo exchange issues only short-lived server-signed PriceLens sessions;
- unknown Google subjects remain free/restricted;
- session signature tampering and expiration fail closed;
- pilot entitlement removal takes effect immediately because tier is re-resolved;
- Terraform requires pinned signing-secret and entitlement-map versions before auth enablement;
- Cloud Armor enforces a dedicated session-exchange request budget;
- the UI exposes a Private beta placeholder without describing it as an outage;
- public artifacts contain only `storage` and no OAuth manifest block;
- pilot Chrome artifacts contain only `storage` + `identity` and the `openid` scope;
- Google token acquisition is interactive and user-triggered;
- Google access tokens are exchanged but never persisted by PriceLens;
- PriceLens pilot sessions expire locally and use session-only extension storage;
- sign-out and sharing revocation clear the pilot session.
