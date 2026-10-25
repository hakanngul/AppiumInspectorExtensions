# TestFly - Appium Inspector

[English](README.md)

Appium 3 için bir VS Code uzantısı: Appium sunucusunu başlatın ve durdurun, yüklü sürücüleri ve bütün Android ve iOS
cihazları tek yerde görün ve native uygulama ekranlarını, hazır Appium java-client locator'larıyla inceleyin.

> **Durum: 0.3.0, deneme sürümü.** Aşağıdakilerin hepsi yazıldı; sahte Appium sunucularıyla ve gerçek Appium 3.8.0
> başlat/durdur ile test edildi. Gerçek emülatör, simülatör ve cihazlarda oturum henüz bunlara sahip bir makinede
> denenmedi. Bkz. [PLAN.md](PLAN.md).

## Özellikler

- **Appium sunucusu:** Kenar çubuğundan Start ve Stop. Sunucu varsayılan olarak `127.0.0.1:4723` adresinde dinler; çıktısı
  *TestFly Appium* çıktı kanalına yazılır. Adreste zaten çalışan bir sunucu (örneğin terminalden başlatılmış) olduğu gibi
  kullanılır ve uzantı onu asla durdurmaz. Uzantının başlattığı sunucu VS Code kapanınca durdurulur.
- **Sürücüler:** UiAutomator2 ve (macOS'ta) XCUITest, `appium driver list --installed` ile okunur. Eksik bir sürücünün
  kurulum komutu tek tıkla kopyalanır.
- **Cihazlar:** Android emülatör ve cihazlar (adb), iOS simülatörleri (`xcrun simctl`) ve gerçek iOS cihazlar
  (`xcrun devicectl`, yedek olarak `xctrace`). Kullanılamayan cihazlar nedenini gösterir (yetki yok, çevrimdışı, eşleşmemiş).
  Kapalı simülatörler listeden başlatılabilir (Boot).
- **Portlar:** Appium'un portlarını (sunucu, WebDriverAgent 8100-8199, MJPEG akışı 9100, UiAutomator2 8200-8299) hangi
  sürecin tuttuğu ve önce onay soran bir **Stop** düğmesi. Açık kalmış bir WebDriverAgent ya da terminalden başlatılmış
  bir Appium buradan durdurulabilir. iOS'ta 8100 ya da 9100 doluysa oturum boş bir port kullanır.
- **Appium Inspector paneli** (*Open Appium Inspector* ya da cihazın yanındaki *Inspect*):
  - **Oturum:** Cihaz ve uygulama seçin: yüklü uygulama (`appPackage`/`appActivity` ya da `bundleId`), uygulama dosyası
    (`.apk`, `.app`, `.ipa`) ya da uygulamasız, o anki ekran. Capabilities canlı önizlenir; gelişmiş JSON capabilities ve
    kayıtlı profiller desteklenir. Uygulama yeniden kurulmaz ve sıfırlanmaz (`noReset`), oturum bitince açık kalır
    (`shouldTerminateApp: false`).
  - **Yüklü uygulamalar:** Seçilen cihazdaki uygulamalar kendiliğinden okunur (`adb shell pm list packages -3`,
    `xcrun simctl listapps`, `xcrun devicectl device info apps`) ve paket / bundle id alanında liste olarak sunulur;
    cihazda size ait tek uygulama varsa alan doldurulur. Android'de aktivite alanı boşsa açılış aktivitesi cihazdan okunur
    (`-a MAIN -c LAUNCHER`) ve `appium:appActivity` olarak gönderilir; farklı bir aktivite yazılırsa uyarı çıkar.
  - **Ekran ve ağaç:** Element çerçeveli ekran görüntüsü, UI ağacı, ham XML'li Page Source sekmesi, element öznitelikleri.
  - **Eylemler:** Tap, long press, yazı, swipe, back (Android) ve home; W3C actions ile, yedek olarak `mobile:` komutları.
  - **Locator'lar:** id, accessibility id, UiAutomator, iOS predicate, iOS class chain, class name ve XPath; o anki ekranda
    kesin eşleşme sayısı ve cihaza soran **Verify** düğmesi (`findElements`).
  - **Bulucu:** Appium Inspector'daki gibi her stratejiyle arama; yalnızca cihazın çözebildiği stratejiler cihaza gönderilir.
  - **Java:** `@AndroidFindBy` / `@iOSXCUITFindBy` page factory alanları ya da `AppiumBy` sabitleri ve dokunma, yazı,
    swipe, back ve home adımlarından page sınıfı yazan **Record** kipi.

## Java çıktısı

| `codegen.javaClient` | java-client | Selenium | PageFactory import'u |
|---|---|---|---|
| `11` (varsayılan) | 11.x | 4.50+ (yalnızca `selenium-api` gerekir) | `io.appium.java_client.support.PageFactory` |
| `9-10` | 9.x, 10.x | 4.x | `org.openqa.selenium.support.PageFactory` |

Üretilen sınıflar `javac` ile java-client 11.0.0 ve 10.1.1, Selenium 4.51.0'a karşı derlendi.

## Kurulum

```bash
code --install-extension testfly-appium-inspector-0.3.0.vsix
```

Ya da VS Code'da: Extensions görünümü > `...` > *Install from VSIX...*. Sonra etkinlik çubuğundan **TestFly Appium**
görünümünü açın, **Start Appium**'a basın ve bir cihazın yanındaki **Inspect** ile incelemeye başlayın.

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
| `testflyAppiumInspector.ios.preferDevicectl` | `true` | Appium'u `APPIUM_XCUITEST_PREFER_DEVICECTL=1` ile başlat; XCUITest gerçek iPhone'ları bu uzantının listelediği gibi bulur |
| `testflyAppiumInspector.autoRefreshAfterAction` | `true` | Bir eylemden sonra ekranı yeniden oku |
| `testflyAppiumInspector.codegen.javaClient` | `11` | `11` ya da `9-10`, bkz. Java çıktısı |
| `testflyAppiumInspector.codegen.style` | `pageFactory` | `pageFactory` ya da `appiumBy` |

Dock'tan açılan VS Code kabuk profilinizi görmez; uzantı `PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` ve `JAVA_HOME`
değerlerini bir kez giriş kabuğundan okur, varsayılan SDK klasörüne de (`macOS'ta ~/Library/Android/sdk`) bakar ve bunları
Appium'a geçirir. Appium ya da adb yine bulunamazsa yolunu yukarıdaki ayarlardan verin.

## Komutlar

*TestFly Appium: Open Appium Inspector*, *Start Appium Server*, *Stop Appium Server*, *Show Appium Server Log*,
*Reload Devices*.

## Geliştirme

```bash
npm install
npm test                 # derler ve birim testlerini çalıştırır
npm run package          # .vsix üretir
node test/preview.js             # kenar çubuğunu out/preview/*.png olarak çizer (Playwright gerekir)
node test/preview-inspector.js   # inceleme webview'ını sahte bir host ile sürer ve kontrol eder
TESTFLY_REAL_APPIUM=$(which appium) npm test   # ayrıca gerçek bir Appium 3'ü başlatıp durdurur
```

Uzantının çalışma zamanı bağımlılığı yoktur; `vsce package --no-dependencies` ile paketlenir.

## Lisans

Apache-2.0
