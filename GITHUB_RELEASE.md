# Antigrative Dashboard v0.8.20

Fix the missing dashboard in standalone Antigravity IDE 2.6.0. The IDE now hosts its Agent input in a nested Webview, while the previous dashboard searched only the workbench page.

- Mount the controls in the validated Agent frame, retaining the older IDE workbench integration.
- Discover the IDE-owned `agy --hub` HTTP port safely so the dashboard can retrieve current metrics and quotas without relying on outdated language-server logs.
- Limit the bridge to the verified Agent content; handle navigation, frame replacement and pending responses without sending data to unrelated extension views.
- Add regression coverage for frame ownership, embedded UI, legacy IDE layouts, port discovery and install-package completeness.

A Windows IDE 2.6.0 real conversation was accepted by the user. Linux/macOS IDE checks are automated; their signed-in GUI environments still need real-device verification.

## Install or update

- Standalone IDE: download `antigrative-dashboard-ide-0.8.20.vsix` and choose **Install from VSIX…** in the IDE extensions view. Fully quit the IDE and restart using `--remote-debugging-port=0 --remote-debugging-address=127.0.0.1`.
- Desktop App: context details → **⋯ → Check for updates**, or extract `antigrative-dashboard-0.8.20.zip` and run `python manage.py install` (`python3` on Linux/macOS).
- CLI: update the adapter using the included installer if needed. This fix changes IDE compatibility; CLI behavior is unchanged.

Existing statistics and settings are retained. SHA-256 files accompany both packages.

[Compatibility](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.20/COMPATIBILITY.md) · [IDE installation](https://github.com/YOU-SHOULD-KNOW-ME/antigrative-dashboard/blob/v0.8.20/ide/README.md)
