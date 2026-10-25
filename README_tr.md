# TestFly - Appium Inspector

[English](README.md)

Appium 3 için bir VS Code uzantısı: Appium sunucusunu başlatın ve durdurun, yüklü sürücüleri ve bütün Android ve iOS
cihazları tek yerde görün ve (sıradaki adım) native uygulama ekranlarını, hazır Appium java-client locator'larıyla inceleyin.

> **Durum: 0.1.0, geliştiriliyor.** Sunucu, sürücü ve cihaz bölümleri çalışıyor. İnceleme paneli (oturum, ekran görüntüsü,
> UI ağacı, locator'lar, java-client çıktısı) sıradaki faz; bkz. [PLAN.md](PLAN.md).

## Şu an çalışanlar

- **Appium sunucusu:** Kenar çubuğundan Start ve Stop. Sunucu varsayılan olarak `127.0.0.1:4723` adresinde dinler; çıktısı
  *TestFly Appium* çıktı kanalına yazılır. Adreste zaten çalışan bir sunucu (örneğin terminalden başlatılmış) olduğu gibi
  kullanılır ve uzantı onu asla durdurmaz. Uzantının başlattığı sunucu VS Code kapanınca durdurulur.
- **Sürücüler:** UiAutomator2 ve (macOS'ta) XCUITest, `appium driver list --installed` ile okunur. Eksik bir sürücünün
  kurulum komutu tek tıkla kopyalanır.
- **Cihazlar:** Android emülatör ve cihazlar (adb), iOS simülatörleri (`xcrun simctl`) ve gerçek iOS cihazlar
  (`xcrun devicectl`, yedek olarak `xctrace`). Kullanılamayan cihazlar nedenini gösterir (yetki yok, çevrimdışı, eşleşmemiş).
  Kapalı simülatörler listeden başlatılabilir (Boot).

## Gereksinimler

| Araç | Sürüm | Ne için |
|---|---|---|
| VS Code | 1.85 ya da sonrası | |
| Node.js | 20.19+, 22.12+ ya da 24+ | Appium 3 |
| Appium | 3.x (3.8.0 ile denendi) | `npm install -g appium` |
| UiAutomator2 sürücüsü | 8.x (8.7.0 ile denendi) | Android: `appium driver install uiautomator2` |
| XCUITest sürücüsü | 12.x | iOS: `appium driver install xcuitest` (yalnızca macOS) |
| Android SDK platform-tools | | Android: `adb`; `ANDROID_HOME` tanımlı olmalı |
| Xcode | 15 ya da sonrası | iOS simülatör ve cihazlar |

Windows ve Linux: yalnızca Android. macOS: Android ve iOS.

### Gerçek iOS cihazlar

Appium cihaza WebDriverAgent'ı kurar ve iOS yalnızca imzalı uygulama çalıştırır. Xcode'a (Settings > Accounts) eklenmiş
ücretsiz bir Apple ID yeterlidir; ücretli Apple Developer Program üyeliği gerekmez.

- `testflyAppiumInspector.ios.xcodeOrgId`: Team ID'niz (10 karakter).
- `testflyAppiumInspector.ios.xcodeSigningId`: `Apple Development` (varsayılan).
- `testflyAppiumInspector.ios.updatedWDABundleId`: ücretsiz Apple ID ile size özgü bir bundle id, örneğin
  `com.adiniz.WebDriverAgentRunner`.

Cihazda: bilgisayara güvenin ve Geliştirici Modu'nu açın (Ayarlar > Gizlilik ve Güvenlik). Ücretsiz Apple ID ile imza 7 gün
geçerlidir.

## Ayarlar

| Ayar | Varsayılan | |
|---|---|---|
| `testflyAppiumInspector.appium.path` | `appium` | Appium çalıştırılabilir dosyası |
| `testflyAppiumInspector.appium.host` | `127.0.0.1` | Başlatılan sunucunun adresi |
| `testflyAppiumInspector.appium.port` | `4723` | Port |
| `testflyAppiumInspector.appium.basePath` | `/` | `--base-path`, örneğin `/wd/hub` |
| `testflyAppiumInspector.appium.allowCors` | `true` | `--allow-cors` ile başlat |
| `testflyAppiumInspector.appium.autoStart` | `false` | Görünüm açılınca sunucuyu başlat |
| `testflyAppiumInspector.adbPath` | (boş) | adb; boşsa `ANDROID_HOME`, `ANDROID_SDK_ROOT` ya da PATH |
| `testflyAppiumInspector.ios.*` | | Gerçek iOS cihaz imzalama, yukarıya bakın |

Dock'tan açılan VS Code, kabuk profilinizdeki PATH'i görmez; uzantı bunu bir kez giriş kabuğundan okur. Appium ya da adb
yine bulunamazsa yolunu yukarıdaki ayarlardan verin.

## Komutlar

*TestFly Appium: Start Appium Server*, *Stop Appium Server*, *Show Appium Server Log*, *Reload Devices*.

## Geliştirme

```bash
npm install
npm test                 # derler ve birim testlerini çalıştırır
npm run package          # .vsix üretir
node test/preview.js     # kenar çubuğunu out/preview/*.png olarak çizer (Playwright gerekir)
TESTFLY_REAL_APPIUM=$(which appium) npm test   # ayrıca gerçek bir Appium 3'ü başlatıp durdurur
```

Uzantının çalışma zamanı bağımlılığı yoktur; `vsce package --no-dependencies` ile paketlenir.

## Lisans

Apache-2.0
