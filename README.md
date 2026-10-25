# TestFly - Appium Inspector

[Türkçe](README_tr.md)

A VS Code extension for Appium 3: start and stop the Appium server, see the installed drivers and every Android and iOS
device in one place, and (coming next) inspect native app screens with ready-to-paste Appium java-client locators.

> **Status: 0.1.0, in development.** The server, driver and device parts work. The inspector panel (session, screenshot,
> UI tree, locators, java-client output) is the next phase; see [PLAN.md](PLAN.md).

## What works today

- **Appium server:** Start and Stop from the sidebar. The server listens on `127.0.0.1:4723` by default; its output goes
  to the *TestFly Appium* output channel. A server that already runs on the address (started in a terminal, for example)
  is used as is and never stopped by the extension. The server the extension started is stopped when VS Code closes.
- **Drivers:** UiAutomator2 and (on macOS) XCUITest, read from `appium driver list --installed`. A missing driver has a
  copy button for its install command.
- **Devices:** Android emulators and devices (adb), iOS simulators (`xcrun simctl`) and real iOS devices
  (`xcrun devicectl`, with `xctrace` as fallback). Devices that cannot be used show why (unauthorized, offline, not
  paired). Shut down simulators can be booted from the list.

## Requirements

| Tool | Version | Needed for |
|---|---|---|
| VS Code | 1.85 or later | |
| Node.js | 20.19+, 22.12+ or 24+ | Appium 3 |
| Appium | 3.x (tested with 3.8.0) | `npm install -g appium` |
| UiAutomator2 driver | 8.x (tested with 8.7.0) | Android: `appium driver install uiautomator2` |
| XCUITest driver | 12.x | iOS: `appium driver install xcuitest` (macOS only) |
| Android SDK platform-tools | | Android: `adb`; set `ANDROID_HOME` |
| Xcode | 15 or later | iOS simulators and devices |

Windows and Linux: Android only. macOS: Android and iOS.

### Real iOS devices

Appium installs WebDriverAgent on the device, and iOS runs only signed apps. A free Apple ID added in Xcode
(Settings > Accounts) is enough; a paid Apple Developer Program membership is not required.

- `testflyAppiumInspector.ios.xcodeOrgId`: your Team ID (10 characters).
- `testflyAppiumInspector.ios.xcodeSigningId`: `Apple Development` (default).
- `testflyAppiumInspector.ios.updatedWDABundleId`: with a free Apple ID, a bundle id of your own, for example
  `com.yourname.WebDriverAgentRunner`.

On the device: trust the computer and turn on Developer Mode (Settings > Privacy & Security). With a free Apple ID the
signature lasts 7 days.

## Settings

| Setting | Default | |
|---|---|---|
| `testflyAppiumInspector.appium.path` | `appium` | Appium executable |
| `testflyAppiumInspector.appium.host` | `127.0.0.1` | Address of the started server |
| `testflyAppiumInspector.appium.port` | `4723` | Port |
| `testflyAppiumInspector.appium.basePath` | `/` | `--base-path`, for example `/wd/hub` |
| `testflyAppiumInspector.appium.allowCors` | `true` | Start with `--allow-cors` |
| `testflyAppiumInspector.appium.autoStart` | `false` | Start the server when the view opens |
| `testflyAppiumInspector.adbPath` | (empty) | adb; empty: `ANDROID_HOME`, `ANDROID_SDK_ROOT` or PATH |
| `testflyAppiumInspector.ios.*` | | Real iOS device signing, see above |

VS Code started from the Dock does not see the PATH of your shell profile; the extension reads it from a login shell
once. If Appium or adb is still not found, set its path above.

## Commands

*TestFly Appium: Start Appium Server*, *Stop Appium Server*, *Show Appium Server Log*, *Reload Devices*.

## Development

```bash
npm install
npm test                 # builds and runs the unit tests
npm run package          # builds the .vsix
node test/preview.js     # renders the sidebar to out/preview/*.png (needs Playwright)
TESTFLY_REAL_APPIUM=$(which appium) npm test   # also starts and stops a real Appium 3
```

The extension has no runtime dependencies; it is packaged with `vsce package --no-dependencies`.

## License

Apache-2.0
