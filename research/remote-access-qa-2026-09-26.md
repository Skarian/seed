# Remote access setting — verification

Seed now accepts one optional HTTPS Remote URL under **Admin → Access**, alongside its existing local address. The setting is persisted in the existing user configuration and applies to new requests without a restart. Removing it leaves local access available. It does not create a tunnel or add authentication; the reverse proxy must provide authentication.

## Verified

- Build, TypeScript check, and all 453 unit/integration tests passed.
- Four browser tests passed against isolated storage: desktop/mobile save, persistence, removal, invalid input, load/save errors, navigation during an in-flight response, and narrow-screen layout.
- A real local TLS reverse proxy preserved Host and served the application, deep links, static assets, and APIs. Host/Origin mismatches and spoofed forwarding headers were rejected.
- Real fixture uploads resumed across chunks; images decoded and video playback/seek and byte ranges worked through the proxy.
- Chat events streamed through the proxy, including a real 25-second heartbeat and reconnection. No model call was made.
- Removing the Remote URL blocked new proxy requests while local requests continued to work.
- Failed server-side settings persistence retained the previous policy. CLI setup preserved the saved Remote URL.

The browser tests explicitly inject HTTP failures for error-state coverage. Actual filesystem persistence failure is covered separately in the server tests. All fixtures use disposable content; no private requests, chats, media, or credentials were inspected, and no provider or GPU calls were made.

## Visual review

Each of the nine screenshots was opened and reviewed individually at full resolution:

| Scenario | Desktop | Mobile |
| --- | --- | --- |
| 931: Optional, unset address | Passed | Passed |
| 932: Long saved address | Passed | Passed |
| 933: Invalid address | Passed | Passed |
| 934: Failed save retaining draft | Passed | Passed |
| 935: Failed save at 320px width | — | Passed |

The fields stay within the viewport, messages wrap, and narrow-screen actions stack. Long addresses scroll within the input instead of widening the card.

Run `node scripts/test-remote-access.mjs` to regenerate the proxy checks and visual atlas in `.local/remote-access-atlas`. OpenSSL is required for the temporary test certificate. The gallery links to the separate 320px capture; common desktop/mobile scenarios also have numbered mosaics. Capture hashes and individual review results are saved with the published QA artifacts.

## Remaining deployment check

No real Cloudflare hostname or Access policy was configured for this test. Verify actual sign-in, denied unauthenticated access, streaming, uploads, and media playback once the named tunnel is set up. The local TLS test establishes application/proxy compatibility, not Cloudflare account configuration. Existing streaming connections are not revoked by changing this setting; session access belongs to the authentication proxy.
