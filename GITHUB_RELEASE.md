# Antigrative Dashboard v0.8.18

Adapt [PR #28](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/pull/28) by HumanMus1c, improving Windows TUN discovery and adding Argon weekly-quota support across the App, IDE and CLI.

- Accept explicit blank Windows socket states only after PID/address validation and a bounded, payload-free loopback connection to the expected target. Missing state fields remain rejected. Normal discovery and retry backoff are preserved.
- Distinguish the returned `gemini-argon-wtu-weekly` bucket from regular Gemini. Show only its real weekly window; zero, disabled and unknown values remain distinct. If no dedicated group is returned, retain the reported shared Gemini group and label.
- Display the installed version dynamically in the side-panel header. Narrow layouts give space back to controls; the version remains in the title tooltip.
- CLI displays all three reported quota families and adds `--preview-argon`, retaining color thresholds and existing cache calculations.

The TUN blank-state case and dedicated Argon group have regression coverage with real local sockets and synthetic interface payloads. The reporter's exact driver and a signed-in account returning the dedicated Argon group still need real-environment confirmation.

## Install or update

- App: context details → **⋯ → Check for updates**, or extract `antigrative-dashboard-0.8.18.zip` and run `python manage.py install` (`python3` on Linux/macOS).
- Standalone IDE: install `antigrative-dashboard-ide-0.8.18.vsix` using **Install from VSIX…**.
- CLI: update the status-line adapter using the included installer and reopen the CLI.
- Fully quit and reopen the relevant host. Existing statistics and settings are retained; SHA-256 files accompany both packages.

[Compatibility](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.18/COMPATIBILITY.md) · [CLI documentation](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.18/docs/CLI.md)
