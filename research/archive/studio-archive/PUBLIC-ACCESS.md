# Deferred public frontend access

Deferred by owner September 12, 2026. Not a prerequisite for worker networking.

## Public access refinement: existing-account login

Owner expects occasional browser uploads and prefers existing-account sign-in through established software, not a Seed authentication implementation. GPU-to-PC transfers remain on private Tailscale/SSH and never traverse Funnel. Public delivery of Library images/video still uses Funnel, so validate playback and downloads as well as uploads.

Proposed ingress: browser -> Funnel HTTPS -> OAuth2 Proxy -> Seed. OAuth2 Proxy is the leading candidate because it performs login and reverse proxying in one existing service. Tinyauth remains an alternative if deployment fits better; do not add both or a general identity platform. Confirm maintained Windows packaging/runtime and lifecycle integration before selection. Keep the gateway local and configure public ingress to reach only the gateway, never the unprotected app. Preserve explicitly configured LAN access without a public bypass; verify Host/Origin and forwarded-header behavior.

OAuth2 Proxy owns OAuth redirects, login sessions and cookies. Seed setup configures the gateway and an explicit owner-account allowlist. Existing-account login alone does not authorize every Google/GitHub user. No Seed password database, password reset flow, token parser or custom OAuth implementation. A provider OAuth application/client and callback URL still need one-time setup; this is configuration, not an authentication system we build. Provider choice (Google/GitHub) remains open. Verify all public API, original-media and download routes require the gateway session. Do not expose credentials, local administration or arbitrary worker proxy routes.

Sources: [OAuth2 Proxy](https://github.com/oauth2-proxy/oauth2-proxy), [provider setup and account restriction](https://oauth2-proxy.github.io/oauth2-proxy/7.6.x/configuration/providers/), [Tinyauth authentication](https://tinyauth.app/docs/reference/authentication/). Provider-version-specific instructions must be checked against the selected pinned release during implementation.

