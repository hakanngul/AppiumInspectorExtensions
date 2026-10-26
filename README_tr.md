# TestFly - Appium Inspector

[English](README.md)

Appium 3 için bir VS Code uzantısı. Appium sunucusunu VS Code içinden başlatıp durdurursunuz; bağlı Android ve iOS
cihazları, yüklü sürücüleri ve Appium'un portlarını tek bir kenar çubuğunda görürsünüz. Uygulama ekranlarını inceleyip
Appium java-client için hazır locator'lar ve page sınıfları üretirsiniz.

> **Durum: 0.3.4, deneme sürümü.** Birim testleri sahte Appium sunucularıyla, başlat/durdur testleri gerçek Appium 3.8.0
> ile çalışır. Android emülatör, iOS simülatör ve gerçek iPhone üzerinde denenmeye devam ediyor. Bkz. [PLAN.md](PLAN.md).

## İçindekiler

- [Neler yapabilir](#neler-yapabilir)
- [Gereksinimler](#gereksinimler)
- [Kurulum](#kurulum)
- [Adım adım ilk oturum](#adım-adım-ilk-oturum)
- [Kenar çubuğu](#kenar-çubuğu)
- [Appium Inspector paneli](#appium-inspector-paneli)
- [Java çıktısı](#java-çıktısı)
- [Gerçek iOS cihazlar](#gerçek-ios-cihazlar)
- [Ayarlar](#ayarlar)
- [Komutlar](#komutlar)
- [Sorun giderme](#sorun-giderme)
- [Geliştirme](#geliştirme)

## Neler yapabilir

- **Appium sunucusu:** Start, Stop ve Restart kenar çubuğunda. Sunucunun çıktısı *TestFly Appium* çıktı kanalına yazılır.
  Terminalden başlatılmış bir Appium da tanınır ve olduğu gibi kullanılır.
- **Sürücüler:** UiAutomator2 ve XCUITest kurulu mu, hangi sürümde. Eksik sürücünün kurulum komutu tek tıkla kopyalanır.
- **Cihazlar:** Android emülator ve cihazlar, iOS simülatörleri ve gerçek iPhone/iPad. Kullanılamayan cihazın nedeni
  yazılır (yetki yok, çevrimdışı, eşleşmemiş). Kapalı simülatör listeden açılır.
- **Portlar:** Appium'un portlarını hangi sürecin tuttuğu ve bu süreci durduran bir **Stop** düğmesi.
- **Inspector:** Ekran görüntüsü, UI ağacı, element öznitelikleri, dokunma, kaydırma ve yazı; her element için locator
  önerileri ve cihazda doğrulama.
- **Java üretimi:** `@AndroidFindBy` / `@iOSXCUITFindBy` alanları ya da `AppiumBy` sabitleri; **Record** kipiyle
  yaptığınız adımlardan bir page sınıfı.

Uzantının çalışma zamanı bağımlılığı yoktur; Maven ya da başka bir derleme aracı gerekmez.

## Gereksinimler

| Araç | Sürüm | Ne için |
|---|---|---|
| VS Code | 1.85 ya da sonrası | |
| Node.js | 20.19+, 22.12+ ya da 24+ | Appium 3 |
| Appium | 3.x (3.8.0 ile denendi) | `npm install -g appium` |
| UiAutomator2 sürücüsü | 8.x (8.7.0 ile denendi) | Android: `appium driver install uiautomator2` |
| XCUITest sürücüsü | 12.x | iOS: `appium driver install xcuitest` (yalnızca macOS) |
| Android SDK platform-tools | | Android: `adb` |
| Xcode | 15 ya da sonrası | iOS simülatör ve cihazlar |

Windows ve Linux'ta yalnızca Android, macOS'ta Android ve iOS desteklenir.

Kurulumu terminalden kontrol etmek için:

```bash
node --version
appium --version
appium driver list --installed
adb devices
xcrun simctl list devices booted   # yalnızca macOS
```

## Kurulum

1. `testfly-appium-inspector-0.3.4.vsix` dosyasını indirin.
2. VS Code'da **Extensions** görünümünü açın, sağ üstteki `...` menüsünden **Install from VSIX...** seçin ve dosyayı
   gösterin. Ya da terminalden:

   ```bash
   code --install-extension testfly-appium-inspector-0.3.4.vsix
   ```

3. Etkinlik çubuğunda **TestFly Appium** simgesi belirir.

Yeni bir sürüme geçerken aynı şekilde yeni `.vsix`'i kurun, sonra kenar çubuğundan **Restart** ile Appium'u yeniden
başlatın. Böylece sunucu yeni ayarlarla çalışır.

## Adım adım ilk oturum

### Android

1. Emülatörü açın (Android Studio > Device Manager) ya da cihazı USB ile bağlayıp USB hata ayıklamaya izin verin.
2. **TestFly Appium** görünümünde **Start Appium**'a basın. Kart yeşile döner ve sürümü gösterir.
3. **Devices** listesinde cihazın yanındaki **Inspect**'e basın.
4. **App** bölümünde **Installed app** seçili kalsın. Paket alanına tıklayınca cihazdaki uygulamalar listelenir; kendi
   uygulamanızı seçin (örneğin `com.sirket.uygulama.stage`).
5. **App activity** alanını boş bırakın. Uzantı açılış aktivitesini cihazdan okur.
6. **Start session**'a basın. Ekran görüntüsü ve UI ağacı birkaç saniye içinde gelir.

### iOS simülatör

1. Simülatörü açın ya da listedeki **Boot** ile başlatın.
2. **Start Appium**, sonra simülatörün yanındaki **Inspect**.
3. **Bundle id** alanından uygulamayı seçin (örneğin `com.sirket.uygulama-dev`).
4. **Start session**. İlk iOS oturumu WebDriverAgent'ı derlediği için birkaç dakika sürebilir; sonrakiler hızlıdır.

### Gerçek iPhone

Önce [Gerçek iOS cihazlar](#gerçek-ios-cihazlar) bölümündeki imzalama ayarlarını yapın, sonra simülatördeki adımları
izleyin.

### Uygulamasız ya da dosyadan

- **Current screen:** Hiçbir uygulama başlatılmaz; ekranda ne varsa o incelenir.
- **App file:** `.apk` (Android), `.app` (simülatör) ya da `.ipa` (gerçek cihaz) seçip kurdurursunuz.

Hangi yolu seçerseniz seçin uygulama yeniden kurulmaz, verisi silinmez (`noReset`) ve oturum bitince açık kalır
(`shouldTerminateApp: false`).

## Kenar çubuğu

| Bölüm | Ne gösterir |
|---|---|
| **Appium server** | Durum, adres ve sürüm. **Start**, **Stop**, **Restart**, **Server log**, **Settings**. |
| **Drivers** | UiAutomator2 ve XCUITest; eksikse kurulum komutu. |
| **Devices** | Android ve iOS cihazlar; **Inspect** ve kapalı simülatör için **Boot**. |
| **Ports** | 4723 (Appium), 8100-8199 (WebDriverAgent), 9100 (MJPEG), 8200-8299 (UiAutomator2) portlarını tutan süreçler ve **Stop**. |

- Uzantının başlattığı sunucu VS Code kapanınca durur.
- Terminalden başlatılmış bir sunucuyu **Stop** ya da **Restart** durdurmadan önce sorar.
- **Restart** portu tutan süreci durdurur ve güncel ayarlarla temiz bir sunucu başlatır. Bir ayarı değiştirdiyseniz ya
  da sunucu tuhaf davranıyorsa ilk deneyeceğiniz şey budur.
- iOS'ta 8100 ya da 9100 doluysa oturum kendiliğinden boş bir port kullanır.

## Appium Inspector paneli

### Oturum formu

- **Device:** Bağlı cihazlar.
- **App:** Installed app, App file ya da Current screen.
- **Capabilities:** Gönderilecek capabilities'in canlı önizlemesi.
- **Advanced capabilities (JSON):** Üretilen değerlerin üzerine yazılır. Önek yoksa `appium:` eklenir; `null` bir değeri
  kaldırır. Örnek:

  ```json
  { "autoGrantPermissions": true, "language": "tr", "locale": "TR" }
  ```

- **Saved profiles:** Formu bir adla kaydedip sonra tek tıkla geri yükleyin.

### Ekran

- **Screen:** Ekran görüntüsü. Elementin üzerine gelince çerçevesi görünür, tıklayınca seçilir.
- **UI Tree:** Elementlerin ağacı; ağaçtan seçim ekranda da işaretlenir.
- **Page Source:** Appium'un döndürdüğü ham XML.
- **Element:** Seçili elementin öznitelikleri ve sınırları (Bounds).

### Eylemler

**Tap**, long press, yazı, dört yöne swipe, **Back** (Android) ve **Home**. Eylemler W3C actions ile gönderilir; sürücü
desteklemezse `mobile:` komutları kullanılır. Her eylemden sonra ekran yeniden okunur (`autoRefreshAfterAction`).

### Locator'lar

Seçili element için öneriler: id, accessibility id, `-android uiautomator`, `-ios predicate string`,
`-ios class chain`, class name ve XPath. Her önerinin yanında o anki ekranda kaç elementle eşleştiği yazar. **Verify**
aynı locator'ı cihaza sorar (`findElements`). Tek eşleşmeli bir id ya da accessibility id genelde en sağlam seçimdir.

### Bulucu

Appium Inspector'daki gibi herhangi bir stratejiyle arama yapılır. Ekrandaki XML'den çözülebilenler yerel olarak,
yalnızca cihazın çözebildikleri (UiAutomator, predicate, class chain) cihaza sorularak bulunur.

### Record

**Record**'a basıp uygulamada dokunun, yazın, kaydırın. Adımlar **Recorded** sekmesinde birikir. **Copy** ile kopyalayın
ya da **Open in editor** ile yeni bir Java dosyası olarak açın.

## Java çıktısı

Record kipinde e-posta yazıp giriş düğmesine basınca şu sınıf üretilir:

```java
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.pagefactory.AndroidFindBy;
import io.appium.java_client.pagefactory.AppiumFieldDecorator;
import io.appium.java_client.support.PageFactory;
import org.openqa.selenium.WebElement;

public class LoginPage {
    private final AppiumDriver driver;

    @AndroidFindBy(id = "com.example.shop:id/email")
    private WebElement emailInput;

    @AndroidFindBy(accessibility = "loginButton")
    private WebElement loginButton;

    public LoginPage(AppiumDriver driver) {
        this.driver = driver;
        PageFactory.initElements(new AppiumFieldDecorator(driver), this);
    }

    public void recordedFlow() {
        emailInput.sendKeys("test@example.com");
        loginButton.click();
    }
}
```

Alan adları elementin metninden ve türünden çıkarılır; Türkçe harfler (ı, ş, ğ, ü, ö, ç) ASCII karşılıklarına çevrilir.

| `codegen.javaClient` | java-client | Selenium | PageFactory import'u |
|---|---|---|---|
| `11` (varsayılan) | 11.x | 4.50+ (yalnızca `selenium-api` gerekir) | `io.appium.java_client.support.PageFactory` |
| `9-10` | 9.x, 10.x | 4.x | `org.openqa.selenium.support.PageFactory` |

`codegen.style` ayarı `appiumBy` olursa alanlar yerine `private static final By` sabitleri üretilir. Üretilen sınıflar
`javac` ile java-client 11.0.0 ve 10.1.1, Selenium 4.51.0'a karşı derlendi.

## Gerçek iOS cihazlar

Appium cihaza WebDriverAgent'ı kurar ve iOS yalnızca imzalı uygulama çalıştırır. Xcode'a (Settings > Accounts) eklenmiş
ücretsiz bir Apple ID yeterlidir; ücretli Apple Developer Program üyeliği gerekmez.

| Ayar | Değer |
|---|---|
| `testflyAppiumInspector.ios.xcodeOrgId` | Team ID'niz (10 karakter; Xcode > Settings > Accounts ya da developer.apple.com) |
| `testflyAppiumInspector.ios.xcodeSigningId` | `Apple Development` (varsayılan) |
| `testflyAppiumInspector.ios.updatedWDABundleId` | Ücretsiz Apple ID ile size özgü bir bundle id, örneğin `com.adiniz.WebDriverAgentRunner` |

Cihazda:

1. iPhone'u kabloyla bağlayın, kilidini açın ve **Bu bilgisayara güven** deyin.
2. **Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu**'nu açın ve cihazı yeniden başlatın.
3. İlk oturumdan sonra **Ayarlar > Genel > VPN ve Cihaz Yönetimi**'nden geliştirici sertifikasına güvenin.

Ücretsiz Apple ID ile imza 7 gün geçerlidir; süre dolunca oturum yeniden imzalar. Team ID girilmemişse panel bir uyarı
gösterir ama oturumu engellemez.

## Ayarlar

VS Code'da **Settings** içinde `testflyAppiumInspector` arayın ya da kenar çubuğundaki **Settings** bağlantısını kullanın.

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `appium.path` | `appium` | Appium çalıştırılabilir dosyası |
| `appium.host` | `127.0.0.1` | Başlatılan sunucunun adresi |
| `appium.port` | `4723` | Port |
| `appium.basePath` | `/` | `--base-path`, örneğin `/wd/hub` |
| `appium.allowCors` | `true` | `--allow-cors` ile başlat |
| `appium.autoStart` | `false` | Görünüm açılınca sunucuyu başlat |
| `adbPath` | (boş) | adb; boşsa `ANDROID_HOME`, `ANDROID_SDK_ROOT` ya da PATH |
| `ios.xcodeOrgId`, `ios.xcodeSigningId`, `ios.updatedWDABundleId` | | Gerçek iOS cihaz imzalama, yukarıya bakın |
| `ios.preferDevicectl` | `false` | Appium'u `APPIUM_XCUITEST_PREFER_DEVICECTL=1` ile başlat; yalnızca USB'den bulunamayan (Wi-Fi) gerçek iPhone için. Açıkken simülatör oturumları açılmaz |
| `autoRefreshAfterAction` | `true` | Bir eylemden sonra ekranı yeniden oku |
| `session.fastStart` | `true` | Daha hızlı oturum: logcat/syslog kaydı yok, boşta bekleme 10 sn yerine 300 ms (Android) / 1 sn (iOS). Cihaz ayarlarına dokunulmaz. Gelişmiş JSON önceliklidir |
| `codegen.javaClient` | `11` | `11` ya da `9-10`, bkz. Java çıktısı |
| `codegen.style` | `pageFactory` | `pageFactory` ya da `appiumBy` |

Tablodaki adların hepsinin başında `testflyAppiumInspector.` vardır.

Dock'tan açılan VS Code kabuk profilinizi (`.zshrc`) görmez. Uzantı `PATH`, `ANDROID_HOME`, `ANDROID_SDK_ROOT` ve
`JAVA_HOME` değerlerini bir kez giriş kabuğundan okur, varsayılan SDK klasörüne de (macOS'ta `~/Library/Android/sdk`)
bakar ve bunları Appium'a geçirir.

## Komutlar

Komut paletinden (`Cmd+Shift+P` / `Ctrl+Shift+P`) **TestFly Appium:** ile başlayanlar:

- *Open Appium Inspector*
- *Start Appium Server*, *Stop Appium Server*, *Restart Appium Server*
- *Show Appium Server Log*
- *Reload Devices*

## Sorun giderme

Önce **Server log**'u açın: her oturum `New session on …` satırıyla başlar, ardından Appium'un hatası gelir. Panel de
bilinen hataların yanına ne yapılacağını yazar.

| Hata ya da belirti | Neden ve çözüm |
|---|---|
| `adb not found` / `ANDROID_HOME is not set` | Uzantı adb'yi bulamadı. `adbPath` ayarına tam yolu verin, örneğin `~/Library/Android/sdk/platform-tools/adb`, sonra **Restart**. |
| `UiAutomation not connected` (Android) | Uzantı önce UiAutomation'ı serbest bırakıp yeniden dener, sonra UiAutomator2 sunucu uygulamalarını kaldırıp Appium'a yeniden kurdurur. Yine olmazsa UiAutomation kullanan başka aracı (başka bir inspector, uiautomatorviewer) kapatın ya da emülatörü **Cold Boot Now** ile yeniden açın. |
| `Activity ... does not exist` (Android) | Yazdığınız aktivite uygulamada yok. **App activity** alanını boş bırakın; açılış aktivitesi cihazdan okunur. |
| `Unknown device or simulator UDID` (iPhone) | Appium cihazı USB'de görmüyor. Kabloyla bağlayın, kilidi açın, bilgisayara güvenin. Cihaz yalnızca Wi-Fi'deyse `ios.preferDevicectl`'i açıp **Restart**. |
| `RemoteXPC tunnel` hatası (simülatör) | Sunucu `APPIUM_XCUITEST_PREFER_DEVICECTL=1` ile çalışıyor ve simülatörü gerçek cihaz sanıyor. `ios.preferDevicectl`'i kapatıp **Restart**. |
| Port dolu, WebDriverAgent ya da UiAutomator2 bağlanamıyor | Önceki bir oturumdan kalan bir süreç portu tutuyor. **Ports** bölümünden durdurun ya da **Restart**. |
| Uygulama listesi boş | Cihaz hazır mı (`adb devices`, `xcrun simctl list devices booted`)? Alanın yanındaki **Reload apps**'e basın. Android'de yalnızca sonradan kurulan uygulamalar listelenir; iOS'ta sizin uygulamalarınız sistem uygulamalarından önce gelir. |
| Oturum çok yavaş açılıyor | İlk iOS oturumu WebDriverAgent'ı derler, bu normaldir. Log'daki `Session … started in` ve `Screen read in` sürelerine bakın; `session.fastStart` açık olmalı. |
| Ayar değişikliği etkisiz | Sunucu eski ayarlarla çalışıyor. **Restart**. |

## Geliştirme

```bash
npm install
npm test                         # derler ve birim testlerini çalıştırır
npm run package                  # .vsix üretir
node test/preview.js             # kenar çubuğunu out/preview/*.png olarak çizer (Playwright gerekir)
node test/preview-inspector.js   # inceleme webview'ını sahte bir host ile sürer ve kontrol eder
TESTFLY_REAL_APPIUM=$(which appium) npm test   # ayrıca gerçek bir Appium 3'ü başlatıp durdurur
```

Kaynak yapısı:

| Klasör | İçerik |
|---|---|
| `src/appium/` | Appium istemcisi, sunucu yönetimi, oturum, hareketler, capabilities |
| `src/devices/` | adb, simctl, devicectl ile cihaz ve uygulama listeleri |
| `src/ports.ts` | Port kullanımı ve süreç durdurma |
| `src/controller.ts` | Sunucu, cihaz ve port durumu |
| `src/sidebar.ts`, `src/inspectorPanel.ts` | Kenar çubuğu ve inceleme paneli |
| `media/` | Webview HTML, CSS ve JavaScript'i; locator ve Java üretimi |
| `test/` | Birim testleri, sahte Appium ve adb, örnek çıktılar |

Uzantı `vsce package --no-dependencies` ile paketlenir.

## Lisans

Apache-2.0
