# TestFly - Appium Inspector

[Türkçe](README_tr.md)

A VS Code extension for Appium 3: start and stop the Appium server, see the installed drivers and every Android and iOS
device in one place, and inspect native app screens with ready-to-paste Appium java-client locators.

> **Status: 0.3.3, test release.** Everything below is built and covered by tests against fake Appium servers and
> a real Appium 3.8.0 server start/stop; sessions on real emulators, simulators and devices still need a first run on a
> machine that has them. See [PLAN.md](PLAN.md).

## Features

- **Appium server:** Start and Stop from the sidebar. The server listens on `127.0.0.1:4723` by default; its output goes
  to the *TestFly Appium* output channel. A server that already runs on the address (started in a terminal, for example)
  is used as is; Stop asks before stopping it. **Restart** stops whatever holds the port (asking first) and starts a clean
  server with the current settings. The server the extension started is stopped when VS Code closes.
- **Drivers:** UiAutomator2 and (on macOS) XCUITest, read from `appium driver list --installed`. A missing driver has a
  copy button for its install command.
- **Devices:** Android emulators and devices (adb), iOS simulators (`xcrun simctl`) and real iOS devices
  (`xcrun devicectl`, with `xctrace` as fallback). Devices that cannot be used show why (unauthorized, offline, not
  paired). Shut down simulators can be booted from the list.
- **Ports:** which process listens on Appium's ports (the server, WebDriverAgent 8100-8199, the MJPEG stream 9100,
  UiAutomator2 8200-8299), with a **Stop** button that asks first. A leftover WebDriverAgent or an Appium started in a
  terminal can be stopped from here. On iOS, a busy 8100 or 9100 is swapped for a free port in the session.
- **Appium Inspector panel** (*Open Appium Inspector*, or *Inspect* next to a device):
  - **Session:** pick a device and an app: an installed app (`appPackage`/`appActivity` or `bundleId`), an app file
    (`.apk`, `.app`, `.ipa`), or the current screen without an app. A live preview shows the capabilities; advanced JSON
    capabilities and saved profiles are supported. The app is not reinstalled or reset (`noReset`) and keeps running when
    the session ends (`shouldTerminateApp: false`).
  - **Installed apps:** the apps on the chosen device are read automatically (`adb shell pm list packages -3`,
    `xcrun simctl listapps`, `xcrun devicectl device info apps`) and offered in the package / bundle id field; with a
    single app of your own it is filled in. On Android, with the activity field empty, the launcher activity is read
    from the device (`-a MAIN -c LAUNCHER`) and passed as `appium:appActivity`; a typed activity that differs is flagged.
  - **Screen and tree:** screenshot with element outlines, UI tree, Page Source tab with the raw XML, element attributes.
  - **Actions:** tap, long press, type, swipe, back (Android) and home, through W3C actions with `mobile:` fallbacks.
  - **Locators:** id, accessibility id, UiAutomator, iOS predicate, iOS class chain, class name and XPath, with exact
    match counts on the current screen and a **Verify** button that asks the device (`findElements`).
  - **Finder:** search by any strategy, as in Appium Inspector; strategies only the device can evaluate are sent to it.
  - **Java:** `@AndroidFindBy` / `@iOSXCUITFindBy` page factory fields or `AppiumBy` constants, and **Record** mode, which
    writes a page class from your taps, typing, swipes, back and home.

## Java output

| `codegen.javaClient` | java-client | Selenium | PageFactory import |
|---|---|---|---|
| `11` (default) | 11.x | 4.50+ (only `selenium-api` is needed) | `io.appium.java_client.support.PageFactory` |
| `9-10` | 9.x, 10.x | 4.x | `org.openqa.selenium.support.PageFactory` |

The generated classes were compiled with `javac` against java-client 11.0.0 and 10.1.1 with Selenium 4.51.0.

## Install

```bash
code --install-extension testfly-appium-inspector-0.3.3.vsix
```

Or in VS Code: Extensions view > `...` > *Install from VSIX...*. Then open the **TestFly Appium** view in the activity
bar, press **Start Appium**, and **Inspect** a device.

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
| `testflyAppiumInspector.ios.preferDevicectl` | `false` | Start Appium with `APPIUM_XCUITEST_PREFER_DEVICECTL=1`, for a real iPhone that Appium does not find over USB (Wi-Fi). Simulator sessions fail on such a server |
| `testflyAppiumInspector.autoRefreshAfterAction` | `true` | Read the screen again after an action |
| `testflyAppiumInspector.session.fastStart` | `true` | Faster sessions: no logcat/syslog capture, Android device setup only on the first session, animations off, idle waits of 300 ms (Android) / 1 s (iOS) instead of 10 s. The advanced JSON wins |
| `testflyAppiumInspector.codegen.javaClient` | `11` | `11` or `9-10`, see Java output |
| `testflyAppiumInspector.codegen.style` | `pageFactory` | `pageFactory` or `appiumBy` |

VS Code started from the Dock does not see your shell profile; the extension reads `PATH`, `ANDROID_HOME`,
`ANDROID_SDK_ROOT` and `JAVA_HOME` from a login shell once, also looks in the default SDK folder
(`~/Library/Android/sdk` on macOS), and passes them to Appium. If Appium or adb is still not found, set its path above.

## Commands

*TestFly Appium: Open Appium Inspector*, *Start Appium Server*, *Stop Appium Server*, *Restart Appium Server*, *Show Appium Server Log*,
*Reload Devices*.

## Development

```bash
npm install
npm test                 # builds and runs the unit tests
npm run package          # builds the .vsix
node test/preview.js             # renders the sidebar to out/preview/*.png (needs Playwright)
node test/preview-inspector.js   # drives the inspector webview with a fake host and checks it
TESTFLY_REAL_APPIUM=$(which appium) npm test   # also starts and stops a real Appium 3
```

The extension has no runtime dependencies; it is packaged with `vsce package --no-dependencies`.

## License

Apache-2.0
