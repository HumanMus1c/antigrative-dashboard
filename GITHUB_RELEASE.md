# Antigrative Dashboard v0.8.17

Fix [#27](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/issues/27): on Windows with TUN networking, false `LISTENING` entries could hide a healthy local API and leave the dashboard waiting for Antigravity to start.

## What changed

- Reject fake-IP and connected TCP entries when identifying local listeners. Supplement the native socket snapshot with one PID-scoped PowerShell query when needed.
- Support the reported nonstandard `State: 0` socket records while checking the owning process, local binding, remote endpoint and port. `Bound`, `Closed`, missing states and unrelated processes are not accepted as listeners.
- Share recovery between the App and standalone IDE. A missing current HTTP or renderer port is no longer masked by another listener or a reused historical HTTP port. Logs provide hints; live PID ownership remains required.
- Prefer the most recently modified readable App log when old and new default locations coexist. Explicit log overrides remain authoritative.
- Preserve the normal netstat fast path, query timeouts, output limits, shared concurrent discovery and failure backoff. No proxy/TUN configuration changes, administrator permissions or statistics reset are required by this fix.

## Verification

Regression coverage includes fake-IP rows, `State: 0`, incomplete socket tables, historical port reuse, IPv4/IPv6, incorrect PIDs, IDE root ownership, multi-instance ambiguity and failed-query backoff. A separate Windows CI/release check verifies real netstat and PowerShell discovery with production timeouts, outside the parallel test workload.

Local validation covers Node, IDE, browser and packaging regressions. The initial local patch discovered the App API and received `GetUserStatus`; signed-in widget acceptance and the reporter's exact TUN driver/environment still need confirmation. Windows, Linux and macOS automated gates run before the release assets are published.

## Install or update

- **Antigravity App:** context details → **⋯ → Check for updates**, or extract `antigrative-dashboard-0.8.17.zip` and run `python manage.py install` (`python3` on Linux/macOS).
- **Standalone Antigravity IDE:** install `antigrative-dashboard-ide-0.8.17.vsix` using **Install from VSIX…**.
- Fully quit and reopen the corresponding host after updating. Existing settings and statistics are retained. Both packages include SHA-256 checksum files.
- If the plugin is offline and its update entry is unavailable, use the matching release package for a manual update. Do not delete saved statistics or change VPN settings to apply this fix.

[Compatibility](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.17/COMPATIBILITY.md) · [Update details](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.17/docs/UPDATES.md)
