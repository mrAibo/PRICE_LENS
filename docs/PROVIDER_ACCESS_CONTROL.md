# Provider Access Control

Status: **public/private-beta entitlement foundation implemented; authenticated identity not yet connected**

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

## Authentication that is intentionally not implemented yet

This slice does **not** introduce a password, embedded pilot token, IP allowlist or
client-controlled plan flag.

The preferred future flow remains:

```text
user login
   ↓
identity service
   ↓
short-lived authenticated session/token
   ↓
PriceLens backend verifies identity
   ↓
server-side entitlement resolver
   ↓
ProviderAccessContext
```

The browser extension must never contain:

- Idealo credentials;
- Geizhals credentials;
- a shared long-lived pilot bearer token;
- a hard-coded "admin" secret;
- provider API secrets.

When authentication is added, the resolver should verify the short-lived credential
and derive the tier/capabilities from trusted server-side state. Client claims alone
must not grant provider access.

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
- the UI exposes a Private beta placeholder without describing it as an outage.
