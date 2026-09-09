# Trusted CircleMember Auth Source Contract

Status: **contract only — not implemented**. No login route, limiter runtime,
session, cookie, or UI code exists yet for public CircleMember authentication.
This document defines the security contract that future work (7G.2.4+) must
build against. It does not implement anything.

Platform decision: **Vercel** (resolves the platform blocker from
7G.2.3). This revision replaces the platform-agnostic placeholders in the
prior version with the concrete Vercel mechanism, verified against current
official Vercel documentation (fetched directly, not from memory or training
data — see citations inline).

## 1. Actual deployment environment

NIA's intended production deployment is Vercel. As of this audit, no
`vercel.json`, linked `.vercel` project, or reverse-proxy/CDN configuration
exists in this repository — meaning the **default, Vercel-recommended
topology** applies: the client connects directly to Vercel's edge network,
with nothing in front of it.

This default topology matters directly to trust: Vercel's own security
documentation explicitly recommends *against* placing a reverse proxy in
front of a Vercel project at all, citing reduced firewall visibility and
inability to accurately identify real end-user IPs as reasons ([Reverse
Proxy Servers and Vercel](https://vercel.com/docs/security/reverse-proxy),
updated 2026-06-16). NIA currently matches this recommended, simplest, most
trustworthy topology.

## 2. Trusted ingress/proxy topology

**No reverse proxy or CDN sits in front of Vercel for NIA.** Per official
Vercel documentation ([Request headers](https://vercel.com/docs/headers/request-headers),
updated 2025-12-13):

> "If you are trying to use Vercel behind a proxy, we currently overwrite
> the `X-Forwarded-For` header and do not forward external IPs. This
> restriction is in place to prevent IP spoofing."

Read precisely: this describes the case of *something else* sitting in
front of Vercel. In that scenario, Vercel's edge overwrites whatever the
upstream proxy or client claims and does not forward it through — i.e.
Vercel does not blindly trust an inbound `X-Forwarded-For` value even from
an upstream proxy, unless that proxy is enrolled in Vercel's own **Verified
Proxy** program (see Section 7, "if the topology ever changes").

Since NIA has no proxy in front of Vercel at all, the client connects
directly to Vercel's edge, and the IP-related headers Vercel's edge sets are
derived from the real TCP connection Vercel itself terminates — not from
anything a client can set in the request.

## 3. Authoritative source signal

**`x-vercel-forwarded-for`** is the header NIA's future limiter must read.

Per the same official documentation:

- `x-forwarded-for`: *"The public IP address of the client that made the
  request."*
- `x-vercel-forwarded-for`: *"This header is identical to the
  `x-forwarded-for` header. However, `x-forwarded-for` could be overwritten
  if you're using a proxy on top of Vercel."*
- `x-real-ip`: *"This header is identical to the `x-forwarded-for` header."*

All three currently carry the same value for NIA's topology (no proxy in
front). `x-vercel-forwarded-for` is selected specifically because it is
documented to remain Vercel's own edge-captured value even if someone later
adds a proxy in front of Vercel without updating this contract — `
x-forwarded-for` is explicitly *not* given that same guarantee. This is a
forward-compatibility choice, not a difference in today's behavior.

**Route Handler access** (confirmed against the official docs' own Next.js
App Router examples): standard Fetch API access, no special runtime API
needed —

```ts
export function POST(request: Request) {
  const source = request.headers.get('x-vercel-forwarded-for');
  // ...
}
```

## 4. Trust-boundary justification

The trust boundary is **Vercel's edge network itself**, not any header name.
The guarantee holds specifically because, and only because:

1. NIA is deployed on Vercel (platform decision, this ticket).
2. No reverse proxy or CDN is placed in front of Vercel for NIA (Section 2).
3. Vercel's own documentation states it overwrites/does not forward an
   external IP through `X-Forwarded-For`-family headers when something else
   is in front — the converse of this, for NIA's actual topology (nothing in
   front), is that the value Vercel's edge sets is derived from the real
   client connection it terminates, not from client-supplied header content.

**If condition 2 ever changes** (NIA adds a CDN/WAF/reverse proxy in front
of Vercel for any reason), this section is invalidated and must be revisited
before deployment — see Section 7's escalation note. This is intentionally
called out because Vercel maintains a *separate, named* trust mechanism
("Verified Proxy") for exactly that case, and it is not automatic.

## 5. Source contract

```
TrustedMemberAuthSource = {
  value: string;                     // normalized IP address, never the raw header value
  establishedBy: "vercel-edge";       // marks that this came from x-vercel-forwarded-for, not client input
}
```

- **Obtained from:** `request.headers.get('x-vercel-forwarded-for')`,
  exclusively. No other header is read for this purpose in production.
- **Validated:** the extracted value must parse as a syntactically valid
  IPv4 or IPv6 address (via Node's standard `net.isIP()` or equivalent — not
  a hand-written regex). Anything that fails to parse is treated as absent.
- **Normalized:** trim surrounding whitespace; lowercase hex-representable
  IPv6 forms. **Correction (7G.2.5): a comma-separated value is rejected
  outright, not reduced to its first or last segment.** NIA's direct-to-Vercel
  topology (Section 2) should only ever produce a single value, per the
  docs' singular phrasing "The public IP address of the client" — a
  comma-separated list means that assumption no longer holds for the
  request in question, and picking a position by convention would be
  guessing which hop is trustworthy without any topology guarantee behind
  the choice. The implementation
  (`src/auth/trusted-member-auth-source.ts`) treats any such value as
  malformed and fails closed, the same as a value that isn't a valid IP at
  all.
- **Unavailable when:** the header is missing, empty, contains more than one
  comma-separated value, or fails IP validation after normalization.
- **When unavailable:** see Section 6 — fail closed, no exceptions, with one
  narrow, explicitly-scoped local/test exception (Section 8).

## 6. Missing/malformed-source behavior (failure policy)

If `TrustedMemberAuthSource` cannot be established for a request:

- The request fails immediately with a **generic public authentication
  failure** — identical shape and wording to an ordinary invalid-credential
  response, so nothing reveals the real cause was infrastructure-level.
- **No** PIN or member-code comparison may be attempted.
- **No** session may be issued.
- **No** fallback to `x-forwarded-for`, `x-real-ip`, or any other header.
- **No** silent bypass of source-level rate limiting.

Deliberately fail-closed: rejecting a legitimate request during a
misconfiguration is preferable to allowing unlimited-rate credential
guessing.

## 7. Required deployment configuration

**None beyond the default.** Because NIA matches Vercel's default,
recommended topology (no proxy in front), no additional Vercel project
setting, header configuration, or Verified Proxy enrollment is required for
`x-vercel-forwarded-for` to be authoritative. This is a materially simpler
outcome than the platform-agnostic version of this contract anticipated.

**Escalation note, if the topology ever changes:** if a CDN or reverse proxy
is ever placed in front of Vercel for NIA, Vercel's [Reverse Proxy Servers
and Vercel](https://vercel.com/docs/security/reverse-proxy) page (updated
2026-06-16) documents a **Verified Proxy** program that must be used instead
of assuming `x-vercel-forwarded-for` remains correct:

- **Verified Proxy Lite** (available on Hobby/Pro, not Enterprise-only) —
  automatic for named providers, each with its own header: Cloudflare
  (`CF-Connecting-IP`), Fastly (`Fastly-Client-IP`), AWS CloudFront
  (`CloudFront-Viewer-Address`), Google Cloud Load Balancing
  (`X-GCP-Connecting-IP`), Imperva (`Incap-Client-IP`), Akamai
  (`True-Client-IP`, with the caveat that "clients may be able to spoof the
  header" unless Akamai's Origin IP ACL is also enabled), Azure Front Door
  (`X-Azure-ClientIP`), F5 (`X-F5-True-Client-IP`).
- **Verified Proxy Advanced** (Enterprise only, self-hosted proxies) —
  requires static egress IPs, a custom header
  (`x-${team-slug}-connecting-ip`), SNI on outbound TLS, and consistent
  project domains; setup requires contacting a Vercel account
  representative.

Whichever applies, this contract's Sections 2–5 must be updated to name the
new authoritative header before any such topology change ships. This is not
a decision this ticket makes speculatively — it is deferred until the need
actually exists.

## 8. Local development and automated tests

Vercel's edge is not present in local development (`next dev`) or in an
automated test runner — `x-vercel-forwarded-for` will simply be absent on
every request in those contexts, since nothing sets it. Per Section 6, an
absent header must fail closed by default, which is safe but would make the
feature undevelopable/untestable locally without an explicit, narrow
exception.

**Design:** a single, NIA-owned, opt-in environment flag —
`ALLOW_TEST_AUTH_SOURCE` — never set in any real Vercel environment
(production or preview), gates a *separate, distinctly-named* test-only
header (e.g. `x-nia-test-source`) that only local dev/test code paths ever
read:

- If `x-vercel-forwarded-for` is present and valid → use it (identical
  behavior on Vercel production, preview, or a real Vercel deployment
  reached via `vercel dev`).
- Else, if `ALLOW_TEST_AUTH_SOURCE` is set **and** `x-nia-test-source` is
  present and valid → use that value instead, tagged
  `establishedBy: "test-override"` (never `"vercel-edge"`) so downstream
  code can distinguish a test-injected source from a genuine one if needed.
- Else → fail closed per Section 6.

This is deliberately **not** based on detecting "are we running on Vercel"
via Vercel's own `VERCEL` / `VERCEL_ENV` system environment variables. Those
exist and are documented ([System environment
variables](https://vercel.com/docs/environment-variables/system-environment-variables),
updated 2026-07-15) but require an explicit "Enable access to System
Environment Variables" project setting to be exposed at runtime at all —
depending on that as a security gate would mean the gate silently fails to
narrow anything if that unrelated dashboard setting is ever toggled off.
`ALLOW_TEST_AUTH_SOURCE` is a flag NIA defines and controls entirely itself,
with no dependency on a separate Vercel dashboard toggle, and it must never
be set in the Production or Preview environment scopes in Vercel's project
settings.

## 9. Privacy contract

- The future limiter must HMAC (keyed hash, server-held secret) the
  normalized `TrustedMemberAuthSource.value` before it is ever written to
  `CircleMemberAuthRateLimitBucket.keyHash`. A bare hash (e.g., unsalted
  SHA-256) is not sufficient — IPv4's address space is small enough to be
  brute-forced/rainbow-tabled without a secret key.
- Raw IP addresses or other raw source identifiers must never be persisted,
  logged, or included in any error message or response.
- Raw PINs, member codes, or credential hashes must never be logged, under
  any code path, regardless of source-identity outcome.

## 10. Future test contract (specified, not implemented)

None of the following are implemented or have been run. They are the
required coverage once the limiter is built:

1. **Trusted source accepted** — a request with `x-vercel-forwarded-for`
   present and a valid IP yields `TrustedMemberAuthSource` with
   `establishedBy: "vercel-edge"`.
2. **Missing source rejected** — header absent, `ALLOW_TEST_AUTH_SOURCE`
   unset → generic fail-closed response; zero credential checks performed.
3. **Malformed source rejected** — header present but not a valid IP (after
   normalization) → same fail-closed path as missing.
4. **Spoofed client header ignored/rejected** — a request where the
   *client* sets `x-vercel-forwarded-for` directly is not honored as
   client-controlled; this must be verified against a real Vercel
   deployment (preview is sufficient), since Vercel's edge — not application
   code — is what overwrites the value, and a local test cannot fake this
   guarantee.
5. **Multiple proxy hops / topology change** — deferred: no test needed
   until Section 7's escalation condition is triggered.
6. **Source normalization** — varied whitespace/comma-list/IPv6
   representations of the same address normalize to the same value.
7. **No raw source persistence** — after a rate-limit check, the persisted
   `keyHash` never equals or contains the raw source value in any
   recognizable form.
8. **No credential verification when source unavailable** — when source is
   missing and no test override applies, the PIN/member-code comparison
   function is never invoked at all (asserted via a spy/mock in the eventual
   test suite, not just that the request fails).
9. **Test override never active without the flag** — with
   `ALLOW_TEST_AUTH_SOURCE` unset, a request carrying `x-nia-test-source` is
   treated identically to one with no source at all (fails closed).
