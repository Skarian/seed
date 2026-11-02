# Windows service

[← Back to Seed](../README.md)

Seed can run as a Windows service that starts at boot with nobody signed in. It
uses Automatic (Delayed Start), restarts after failures, and keeps its data
outside any user profile. The service starts the built app. It does not build or
download packages at boot.

## Layout

| Purpose | Location |
| --- | --- |
| Application and dependencies | The repository, for example `E:\projects\seed` |
| WinSW wrapper and configuration | `C:\Services\Seed\service\Seed.exe` and `Seed.xml` |
| Data, credentials, settings, models | `C:\Services\Seed\profile` |
| Service output | `C:\Services\Seed\logs` |
| App diagnostics | `C:\Services\Seed\profile\log` |

The account is `NT SERVICE\Seed`. It needs modify access to `C:\Services\Seed`
and read access to the repository.

## Install

Build first with `npm ci` and `npm run build`. In an administrator PowerShell:

1. Download [WinSW 2.12.0](https://github.com/winsw/winsw/releases/tag/v2.12.0)
   `WinSW-x64.exe` to `C:\Services\Seed\service\Seed.exe`.
2. Copy `scripts/windows-service.xml` to `C:\Services\Seed\service\Seed.xml`.
   Change its repository paths if your clone is elsewhere.
3. Run `C:\Services\Seed\service\Seed.exe install`.
4. Grant access:

   ```powershell
   icacls C:\Services\Seed /inheritance:r /grant:r "SYSTEM:(OI)(CI)F" "BUILTIN\Administrators:(OI)(CI)F" "$env:USERDOMAIN\$env:USERNAME:(OI)(CI)F" "NT SERVICE\Seed:(OI)(CI)M"
   icacls C:\Services\Seed\* /reset /T /C /Q
   icacls E:\projects\seed /grant "NT SERVICE\Seed:(OI)(CI)RX" /Q
   ```

   Do not add `/T` to the first command. On files it leaves an empty access
   list, and even the service executable becomes unreadable.

5. Run `Start-Service Seed`.

To move an existing profile, stop Seed and move its data, config, log and cache
folders to `profile\data`, `config`, `log` and `cache`. Delete
`data\local-worker\engine\venv`, any links under `data\local-worker\python`, and
`data\local-worker\runtime-ready.json` first, because they contain fixed paths.
Then run local setup again. Verified models stay in place.

Seed binds the address in `profile\config\settings.json`. Use `127.0.0.1` when
all access goes through a tunnel. A LAN address must stay assigned to the PC, or
Seed will not start.

## Manage

```powershell
Get-Service Seed
Stop-Service Seed   # administrator, after checking that jobs and imports are idle
Start-Service Seed  # administrator
```

Stop Seed before rebuilding `dist` or running `npm ci`. Do not run `seed start`
against the default profile while the service is installed. For read-only CLI
checks against the service profile:

```powershell
$env:STUDIO_DEV_ROOT = 'C:\Services\Seed\profile'
node dist/server/cli.js status
node dist/server/cli.js diagnostics
```

The service stops through Seed's authenticated control API, never by killing the
process. WinSW 2.12.0 waits for the main process to exit and does not apply
`stoptimeout` with this stop command. The wrapper does not register for
preshutdown notifications, so Windows shutdown can have a shorter deadline than
a running GPU job needs. Finish or cancel local work before restarting the PC.

## Cloudflare

Run one shared `cloudflared` connector, also as a service under its own account:

- Keep the tunnel token in `C:\ProgramData\cloudflared\token`, readable only by
  SYSTEM, Administrators and `NT SERVICE\Cloudflared`, and pass `--token-file`.
- Route the public hostname to Seed's local URL and preserve the Host header.
- Create the Access application first. Protect the whole hostname, enable
  **Protect with Access** on the route, and bypass caching for the hostname.
- Save the same HTTPS address in **Admin → Access**.

See [Remote access](operations.md#remote-access) for the requirements.

## Rollback

Check for active work, then run `Stop-Service Seed` and
`C:\Services\Seed\service\Seed.exe uninstall`. Keep the profile. To run the same
data by hand, set `STUDIO_DEV_ROOT` to it before `node dist/server/cli.js start`.
Never run a manual instance alongside the service.
