# Windows service on this PC

Seed is published at **https://seed.skaria.cloud** and runs as the `Seed`
Windows service under `NT SERVICE\Seed`. It uses Automatic (Delayed Start),
15/30/60-second failure recovery, and rotating 5 MiB logs with five retained
files. The service starts the already-built app; it does not build or download
packages at boot.

## Locations

| Purpose | Location |
| --- | --- |
| Application and dependencies | `C:\path\to\seed` |
| WinSW wrapper/configuration | `C:\Services\Seed\service\Seed.exe` and `Seed.xml` |
| Active data, credentials, settings | `C:\Services\Seed\profile\data` and `config` |
| Service stdout/stderr | `C:\Services\Seed\logs` |
| App diagnostics | `C:\Services\Seed\profile\log` |
| Existing image/video installation | `C:\path\to\seed\.local\local-worker` |

The explicit `STUDIO_DEV_ROOT` and `SEED_LOCAL_ROOT` in the service XML keep
storage independent of whichever user is signed in. The service identity has
read access to application code, traversal access to its parent folders, and
write access to its profile/logs and local model runtime. The protected service
root permits only this identity, the owner account, administrators and SYSTEM.

The former AppData profile remains as an inactive rollback snapshot. Its unused
`data\local-worker` installation was not copied. Do not launch that old profile
or copy its database over the active service profile after new work is saved.
The service continues to use the existing project model installation.

## Management and updates

PC Manager's `startup-apps.json` is the central inventory. From its folder:

```powershell
.\Manage-PCServices.ps1 -Name Seed -Action Status
# Administrator PowerShell, after checking that jobs and imports are idle:
.\Manage-PCServices.ps1 -Name Seed -Action Stop
.\Manage-PCServices.ps1 -Name Seed -Action Start
.\Manage-PCServices.ps1 -Name Seed -Action Restart
```

Stop Seed while idle before rebuilding `dist`, then start it through the service
manager. Do not run `seed start` with the old default AppData profile. For
read-only CLI diagnostics against the service profile in a PowerShell session:

```powershell
$env:STUDIO_DEV_ROOT = 'C:\Services\Seed\profile'
node dist/server/cli.js status
node dist/server/cli.js diagnostics
```

The service uses `scripts/windows-service.mjs` and Seed's authenticated local
control API for shutdown. With this configured stop command, WinSW 2.12.0 waits
for the main process to exit without applying its `stoptimeout` value; the XML's
180 seconds is not an effective deadline. See the [WinSW 2.12.0 stop implementation](https://github.com/winsw/winsw/blob/v2.12.0/src/WinSW/WrapperService.cs#L268).
Seed's stop helper reports a timeout after 150 seconds, but that alone does not
end WinSW's wait for the main process. An application-level shutdown budget is
still being implemented. Windows shutdown can impose a shorter deadline; this
wrapper does not register for preshutdown notifications. The lifecycle check
below covered an idle coordinator; it does not establish safe teardown of a
hung CUDA engine. The separate GPU-crash investigation remains open.

## Cloudflare

Reuse the one existing `Cloudflared` Windows service and `home-pc` tunnel
(`cb40d541-6b1f-4e30-ba01-0029b92b41d3`). The Seed route forwards to
`http://<lan-ip>:4310`, preserving the public Host header. This address must
remain assigned to the PC; update Seed's host and the tunnel together if it changes.
Local access remains at that same URL.

The existing whole-host Access application and Google identity provider remain
unchanged, allowing the approved owner email. The connector also validates the
application's Access token. The existing hostname-wide cache-bypass rule remains
enabled. `publicOrigin` is `https://seed.skaria.cloud` in the active profile.

The DNS CNAME now points to the shared `home-pc` tunnel. The old `seed-desktop`
tunnel and its other routes remain unchanged. Printer routes are preserved;
the shared connector loaded its new configuration without a restart. Stopping
Cloudflared affects both Seed and the printer.

## Verification on 2026-10-25

- Copied the stopped profile; SQLite integrity check passed; eight completed
  image jobs, media, prompts, LoRAs, activity state and credentials were preserved.
- Verified one Seed Node process in Windows session zero under its virtual
  service identity, automatic delayed startup, and clean idle stop/start.
- Verified the old Node process and listener disappeared on stop and the healthy
  app returned on start. Both local image workflows remain enabled; video remains
  disabled during the crash review. No extra GPU test was launched.
- Verified Cloudflare login redirects for the UI and API. The user confirmed
  that Seed loads successfully after Google sign-in.
- An actual boot with nobody signed in, a sign-out test, and image generation
  under the new service identity have not been performed by this setup task.

Machine-specific setup and verification records are under `.local/`, including
`windows-service-verification.json` and `cloudflare-seed/`. They are not committed.

## Rollback

Check for active work, stop only `Seed`, and preserve its current service profile.
To run the same current data manually, set `STUDIO_DEV_ROOT` and `SEED_LOCAL_ROOT`
to the paths above before using `node dist/server/cli.js start`. Never run the
manual instance alongside the service. Stop it before starting the service again.
Keeping the current data avoids losing post-migration jobs.

The original Cloudflare DNS record and tunnel configuration are recorded in
`.local/cloudflare-seed/before-dns.json` and `before-config.json`. Reverting DNS
to the disconnected old tunnel would make remote Seed unavailable. Inspect the
current shared configuration before rollback so later printer/app changes survive.
