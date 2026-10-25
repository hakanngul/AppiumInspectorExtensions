# TestFly - Appium Inspector: Dönüşüm Planı

Durum: **plan, henüz kod yazılmadı** (25 Ekim 2026). Bu belge, mobilecli tabanlı "TestFly Inspector" VS Code uzantısını
"TestFly - Appium Inspector" uzantısına dönüştürme işinin tek kaynağıdır. Kod, sınıf, metot ve ayar adları İngilizce kalır.

Bu belgede iki tür ifade vardır:

- **Doğrulandı:** Kaynak koddan ya da paket deposundan bu tarihte kontrol edildi (bkz. Bölüm 3).
- **Doğrulanacak:** Hedef davranıştır, kanıt değildir. Hangi fazda ve nasıl kanıtlanacağı yazılıdır.

## İçindekiler

1. Hedef
2. Kapsam
3. Desteklenen sürümler (doğrulanmış)
4. Mevcut durum
5. Hedef mimari
6. Appium istemcisi
7. Appium sunucusu
8. Cihaz keşfi
9. Uygulama girişi ve capabilities
10. Page source ve ağaç
11. Mobil locator'lar
12. Java çıktısı (mobil)
13. Browser Inspector'dan Selenium Inspector'a
14. Arayüz
15. Ayarlar, komutlar ve yeniden adlandırma
16. Fazlar ve kabul ölçütleri
17. Test stratejisi
18. Riskler
19. Doğrulanamayacak ve doğrulanacak şeyler
20. Kararlar
21. Faz 0 ve Faz 1 iş listesi

---

## 1. Hedef

1. **Mobil (Appium Inspector):** mobilecli tamamen kalkar. Yerine Appium 3 (W3C WebDriver) tabanlı bir inspector gelir.
   - Uzantı yerel bir Appium sunucusunu başlatır ya da çalışan bir sunucuya bağlanır.
   - Bağlı Android cihaz ve emülatörler, iOS simülatörleri ve gerçek iOS cihazları **otomatik** listelenir.
   - Uygulama `.apk`, `.app` ya da `.ipa` dosyasıyla, `appPackage`/`appActivity` ile, `bundleId` ile verilir ya da hiç
     verilmez (o anki ekran incelenir).
   - Ekran görüntüsü, UI ağacı (page source), element öznitelikleri ve locator önerileri gösterilir. Her öneri cihazda
     doğrulanabilir.
   - Çıktı **Appium java-client** biçimindedir: PageFactory alanları (`@AndroidFindBy`, `@iOSXCUITFindBy`) ya da `AppiumBy`
     sabitleri. java-client 11.x (varsayılan) ve 9.x/10.x için doğru import'lar üretilir.
2. **Browser (Selenium Inspector):** Tarayıcı yine CDP ile sürülür, ek bağımlılık yoktur. Çıktı **Selenium 4.x Java**
   biçimindedir: `@FindBy` alanları ya da `By.*` ifadeleri.
3. **Kimlik:** Uzantının adı **TestFly - Appium Inspector** olur. TestFly'a özgü kavramlar (`@MobileFind`, `MobileLocator`,
   `Role`, `getByTestId`, `@eN` ref'leri) çıktıdan tamamen kalkar.

## 2. Kapsam

| Konu | İlk sürümde | İlk sürümde yok |
|---|---|---|
| Android emülatör ve gerçek cihaz (UiAutomator2) | Var | Espresso ve Flutter sürücüleri |
| iOS simülatör (XCUITest) | Var | tvOS, watchOS |
| iOS gerçek cihaz | Kodlanır; **bu makinede doğrulanamaz** (Bölüm 19) | WDA imzalamanın otomatikleştirilmesi |
| Yerel Appium sunucusu | Başlatma, durdurma, bağlanma, sürücü kontrolü | Appium'u ya da sürücüleri kurmak |
| macOS, Linux | Var | |
| Windows | Var: yalnızca Android | iOS (Windows'ta mümkün değil) |
| Uzak sunucu (URL ve kimlik bilgisi) | Faz 7 | Bulut cihaz listeleri (BrowserStack vb.) |
| Çalışan bir oturuma bağlanma | Faz 7 | |
| Hybrid uygulama, WebView context | Yok | Native context'te kalınır |
| Record (kayıt) | Var: PageFactory sınıfı ve akış metodu | Assert ya da test senaryosu üretimi |
| Browser Inspector | Var: Selenium 4.x çıktısı | Tarayıcıyı WebDriver ile sürmek, Firefox |

## 3. Desteklenen sürümler (doğrulanmış)

25 Ekim 2026 tarihinde npm ve Maven Central'dan kontrol edildi:

| Bileşen | Güncel sürüm | Not |
|---|---|---|
| `appium` | 3.8.0 | Node `^20.19.0 \|\| ^22.12.0 \|\| >=24.0.0` gerektirir |
| `appium-uiautomator2-driver` | 8.7.0 | Aynı Node koşulu |
| `appium-xcuitest-driver` | 12.20.0 | Aynı Node koşulu |
| `io.appium:java-client` | 11.0.0 | Java 11 bytecode; `selenium-api [4.50.0, 5.0)` |
| `org.seleniumhq.selenium:selenium-java` | 4.51.0 | |

**Destek hedefi:**

- **Sunucu:** Appium 3.x. Appium 2.x için resmi destek yoktur: kullanılan endpoint'ler aynıdır ve büyük olasılıkla çalışır,
  ama sınanmayacak. Sunucu sürümü `GET /status` yanıtından okunur; 3'ten küçükse arayüzde uyarı gösterilir.
- **Sürücüler:** UiAutomator2 8.x, XCUITest 12.x. Komutların varlığı oturum açıldığında `GET /session/:id/appium/commands`
  ve `/appium/extensions` ile sorgulanır (Bölüm 6.3). Bu sayede belirli bir sürücü sürümüne sabitlenmeyiz.
- **Java çıktısı:** java-client 11.x (varsayılan) ve 9.x/10.x. Selenium 4.x.

**java-client 11'deki kırıcı değişiklikler (CHANGELOG'dan doğrulandı, kod üretimini doğrudan etkiliyor):**

- java-client artık yalnızca `selenium-api`'ye bağımlı. `selenium-support` ve `selenium-remote-driver` artık geçişli
  bağımlılık olarak gelmiyor.
- PageFactory (`FindBy`, `FindBys`, `FindAll`, `CacheLookup`, `PageFactory`) `io.appium.java_client.support` paketine
  taşındı. `AppiumFieldDecorator` artık bu paketin `FieldDecorator`'ını uyguluyor. Yani 11.x ile
  `org.openqa.selenium.support.PageFactory.initElements(new AppiumFieldDecorator(driver), this)` **derlenmez**.
- `AppiumDriver` artık bir `RemoteWebDriver` değil. Ancak `WebDriver` ve `JavascriptExecutor` arayüzlerini hâlâ uyguluyor,
  dolayısıyla `driver.navigate().back()` ve `driver.executeScript(...)` çalışmaya devam ediyor.
- `TouchAction` kaldırıldı. Kayıt çıktısında hiç kullanılmayacak; yerine `mobile:` komutları ya da W3C Actions kullanılacak.
- En düşük desteklenen sunucu Appium 3.
- `@AndroidFindBy` (`id`, `accessibility`, `uiAutomator`, `className`, `xpath`, `tagName`, ...) ve `@iOSXCUITFindBy`
  (`accessibility`, `iOSNsPredicate`, `iOSClassChain`, `id`, `className`, `xpath`, ...) aynı paket ve aynı üyelerle
  duruyor (`javap` ile doğrulandı).

**Sunucu tarafında doğrulanan endpoint'ler** (`@appium/base-driver` 10.8.1 rota tablosu): `/status`, `/session`,
`/session/:id/source`, `/screenshot`, `/window/rect`, `/back`, `/actions`, `/execute/sync`, `/elements`,
`/element/:eid/value`, `/appium/settings`, `/appium/commands`, `/appium/extensions`.
Appium 3.8 CLI'si `--allow-cors`, `--address`, `--port` ve `--base-path` bayraklarını hâlâ destekliyor.

## 4. Mevcut durum

- `src/mobilecli.ts`: mobilecli JSON-RPC istemcisi ve sunucu başlatma. mobilecli'ye tek bağımlılık noktası.
- `src/extension.ts`: `InspectorPanel`. Cihaz listesi, yenileme, tap/swipe/text/button akışı. Ağaç ve ekran görüntüsünü
  paralel çeken bir `warm` mantığı var.
- `media/selectors.js`: TestFly seçici üretimi ve çözümü, `@MobileFind` kod üretimi, `hitTest`, `toXml`. Webview'da global
  olarak, Node testlerinde `require` ile kullanılıyor.
- `media/inspector.js`, `body.html`, `inspector.css`: mobil webview. `ref` rozetleri, `Snapshot` sekmesi, "Copy CLI tap" ve
  sunucu düğmesi mobilecli'ye bağlı.
- `src/browserPanel.ts`, `cdp.ts`, `browsers.ts`, `media/browser*.{js,css,html}`, `media/page-agent.js`: Browser Inspector.
  Locator çıktısı TestFly'ın `getByTestId`/`getByRole`/... biçiminde.
- `src/sidebar.ts`, `media/sidebar*`: Mobile/Browser seçimi.
- `src/webview.ts`: CSP tanımı `default-src 'none'; img-src … data:; script-src 'nonce-…'`. `connect-src` yok, dolayısıyla
  webview ağ isteği yapamaz. Bu korunur: Appium'a giden bütün istekler host üzerinden gider.
- `test/browser.test.js` ve `test/selectors.test.js` içinde TestFly monorepo'sundaki Java dosyalarını okuyan "mirror"
  testleri var (`Role.java`, `Locator.java`, `MobileRole.java`).
- Bağımlılıklar yalnızca devDependencies (`typescript`, `@types/*`, `@vscode/vsce`). Çalışma zamanı bağımlılığı **yok**;
  paketleme `vsce package --no-dependencies` ile yapılıyor. **Bu özellik korunur.**
- `engines.vscode: ^1.85.0` (Node 18 üzeri). Global `fetch` ve `AbortSignal.timeout` kullanılabilir.
- `.vscodeignore` dosyasında `LICENSE.txt` yazıyor, oysa gerçek dosyanın adı `LICENSE`.

## 5. Hedef mimari

```
src/
  extension.ts            komutlar, panel ömrü, deactivate temizliği
  appium/
    client.ts             ince W3C istemcisi (fetch), AppiumError, zaman aşımları
    server.ts             Appium sürecini başlat/durdur, /status yoklama, sürücü kontrolü
    session.ts            capabilities üretimi, oturum ömrü, komut sırası, invalid session algılama
    gestures.ts           tap/longPress/swipe/type/back/home: W3C Actions birincil, mobile: yedek
    capabilities.ts       form -> capabilities (saf fonksiyon)
  devices/
    adb.ts                adb devices -l, getprop ayrıştırma
    simctl.ts             xcrun simctl list devices --json ayrıştırma
    devicectl.ts          gerçek iOS cihaz (devicectl, yedek xctrace)
    index.ts              hepsini birleştirip DeviceInfo[] döndürür
  process.ts              platformdan bağımsız spawn/execFile ve süreç ağacını sonlandırma (Windows dahil)
  apps.ts                 .apk/.app/.ipa doğrulama
  browserPanel.ts, cdp.ts, browsers.ts, sidebar.ts, webview.ts   (korunur, uyarlanır)
media/
  locators.js             (selectors.js yerine) mobil locator önerisi ve yerel sayım
  codegen.js              Java çıktısı: AppiumBy, PageFactory, Record sınıfı, Selenium çıktısı
  inspector.js/.css, body.html   mobil webview
  browser.js, page-agent.js      Selenium locator önerileri
test/
  fixtures/               gerçek page source ve komut çıktıları (android.xml, ios.xml, adb.txt, simctl.json, ...)
  java/                   üretilen kodun derlendiğini kanıtlayan küçük Maven projesi (Bölüm 17)
  *.test.js
```

`locators.js` ve `codegen.js` saf JavaScript'tir. Webview'da global olarak, Node testlerinde `require` ile yüklenir; bugünkü
`selectors.js` düzeni sürer.

### 5.1 Neden kendi W3C istemcimiz

- Appium Inspector'ın kendisi de sıradan bir W3C istemcisidir. Cihazla konuşan iş Appium sunucusunda ve sürücülerdedir.
- İhtiyacımız 15 civarında endpoint. Bunlar `fetch` ile yaklaşık 200 satırda yazılır ve mevcut `mobilecli.ts` ile aynı test
  yöntemine (yerel sahte HTTP sunucusu) uyar.
- `webdriver` ya da `webdriverio` paketleri ağır ve ESM ağırlıklı. Eklenirlerse bundler gerekir ve `--no-dependencies`
  paketleme bozulur.

### 5.2 XML tek yerde ayrıştırılır

- Host, ham XML'i **olduğu gibi** webview'a gönderir.
- Webview XML'i `DOMParser('text/xml')` ile ayrıştırır. Ağaç görünümü, hit-test ve XPath sayımı (`document.evaluate`) bu tek
  DOM üzerinde yapılır. XPath sayımı bu yüzden Appium'un gördüğü XML ile birebir uyuşur.
- Node testlerinin `DOMParser`'ı yoktur. Bu yüzden `locators.js`, DOM'u yalnızca küçük bir arayüz üzerinden kullanır
  (`tagName`, `getAttribute`, `children`, `parent`). Testlerde bu arayüzü küçük bir saf JS XML okuyucusu sağlar
  (`test/xml.js`). XPath sayımı Node'da test edilmez; onu Playwright önizleme testi doğrular (Bölüm 17).
- Host tarafında yalnızca XML temizliği (`sanitizeXml`) yapılır: XML 1.0'da geçersiz kontrol karakterleri silinir.

## 6. Appium istemcisi (`appium/client.ts`)

### 6.1 Endpoint'ler

| İş | İstek | Zaman aşımı |
|---|---|---|
| Sunucu hazır mı, sürüm | `GET /status` | 3 sn |
| Oturum aç | `POST /session` `{capabilities:{alwaysMatch:{...}, firstMatch:[{}]}}` | 300 sn (ilk WDA derlemesi uzun sürer) |
| Oturum kapat | `DELETE /session/:id` | 30 sn |
| Page source | `GET /session/:id/source` | 120 sn |
| Ekran görüntüsü | `GET /session/:id/screenshot` | 30 sn |
| Pencere boyutu | `GET /session/:id/window/rect` | 10 sn |
| Hareketler | `POST /session/:id/actions`, ardından `DELETE /session/:id/actions` | 30 sn |
| `mobile:` komutu | `POST /session/:id/execute/sync` `{script:'mobile: …', args:[{…}]}` | 30 sn |
| Geri | `POST /session/:id/back` | 10 sn |
| Element bul (Verify, Type) | `POST /session/:id/elements` `{using, value}` | 30 sn |
| Değer yaz | `POST /session/:id/element/:eid/value` `{text}` | 30 sn |
| Ayarlar | `GET/POST /session/:id/appium/settings` | 10 sn |
| Komut listesi | `GET /session/:id/appium/commands`, `GET /session/:id/appium/extensions` | 10 sn |

Sunucu URL'si `base-path` içerebilir (ör. `http://127.0.0.1:4723/wd/hub`). İstemci yolları bu tabana ekler.

### 6.2 Hata modeli

- W3C hata biçimi `{value:{error, message, stacktrace}}` şeklindedir. `AppiumError` bu üç alanı taşır. Kullanıcıya
  `message` gösterilir, `stacktrace` "TestFly Appium" çıktı kanalına yazılır.
- `unreachable` (bağlantı yok ya da zaman aşımı) ile "sunucu hata döndürdü" ayrı tutulur (mevcut `RpcError.unreachable`
  mantığı sürer).
- `invalid session id` hatasında oturum kapanmış sayılır ve arayüzde "Oturum sona erdi, yeniden başlat" gösterilir.
- Element bulma 404 ya da `no such element` döndürürse bu hata sayılmaz, 0 eşleşme olarak yorumlanır.

### 6.3 Komut sırası ve yetenek algılama

- Appium bir oturumdaki komutları sunucuda zaten sırayla çalıştırır. Mevcut `warm` paralelliği kaldırılır. İstemci de
  kendi tarafında tek bir kuyruk tutar. Sıra şöyledir: önce ekran görüntüsü (hızlı geri bildirim için `shot` mesajı),
  sonra page source.
- Oturum açıldıktan hemen sonra `/appium/extensions` çağrılır ve sürücünün sunduğu `mobile:` komutları bir kümeye alınır.
  Yedek komutlar yalnızca bu kümede bulunuyorsa kullanılır.

### 6.4 Hareketler (`appium/gestures.ts`)

Inspector koordinatla çalışır. Bu yüzden **birincil yol W3C Actions**, yedek yol `mobile:` komutlarıdır.

| Hareket | Birincil (W3C `/actions`, `pointerType: touch`) | Android yedek (UiAutomator2 8.7) | iOS yedek (XCUITest 12.20) |
|---|---|---|---|
| Tap | move, down, pause 50 ms, up | `mobile: clickGesture {x,y}` | `mobile: tap {x,y}` |
| Long press | move, down, pause 800 ms, up | `mobile: longClickGesture {x,y,duration}` | `mobile: touchAndHold {x,y,duration}` |
| Swipe (koordinat) | move, down, move (300 ms), up | `mobile: dragGesture {startX,startY,endX,endY}` | `mobile: dragFromToForDuration {fromX,fromY,toX,toY,duration}` |
| Metin (odaktaki alan) | Element bulunduysa `/element/:eid/value` | `mobile: type {text}` | `mobile: keys {keys}` |
| Geri | `POST /back` | | (iOS'ta düğme devre dışı) |
| Home | | `mobile: pressKey {keycode: 3}` | `mobile: pressButton {name: 'home'}` |

Komut adları ve parametreleri iki sürücünün `execute-method-map.ts` dosyasından doğrulandı. **Dikkat:** iOS `mobile: swipe`
ve Android `mobile: swipeGesture` koordinat almaz; yalnızca yön/alan ve yüzde alır. Bu yüzden koordinatla kaydırma için
kullanılmazlar.

Koordinatlar `window/rect` biriminde gönderilir: Android'de piksel, iOS'ta point. Webview, tıklanan noktayı yüzdeden bu
birime çevirir (Bölüm 10.3).

### 6.5 Güvenlik

- Appium'da kimlik doğrulaması yoktur. Uzantının başlattığı sunucu yalnızca `127.0.0.1` adresinde dinler.
  `--allow-insecure` ve `--relaxed-security` **asla** verilmez.
- Uzak sunucu desteği geldiğinde (Faz 7) kullanıcı adı ve anahtar `SecretStorage`'da tutulur, loga ve çıktı kanalına yazılmaz.
- Capabilities çıktı kanalına yazılırken `appium:xcodeOrgId` gibi değerler olduğu gibi kalır, ama `*key*`, `*password*`,
  `*token*` içeren anahtarların değeri maskelenir.

## 7. Appium sunucusu (`appium/server.ts`)

- Arayüzde **Start Appium / Stop Appium** düğmesi bulunur.
- Başlatma komutu: `appium server --address 127.0.0.1 --port <port> [--allow-cors]`. `appium` yolu
  `appium.path` ayarından alınır.
  - `--allow-cors` yalnızca tarayıcı kökenli istekler için gerekir. Uzantı Node `fetch` ile istek attığı için aslında şart
    değildir. Yine de `appium.allowCors` ayarı olarak bırakılır (varsayılan açık).
- **Akış:**
  1. Önce `GET /status` çağrılır. Sunucu çalışıyorsa ona bağlanılır. Kendi başlatmadığımız bir sunucuyu **asla durdurmayız**,
     yalnızca "bağlı" gösteririz.
  2. Çalışmıyorsa süreç başlatılır ve `/status` hazır olana kadar yoklanır (zaman aşımı 30 sn). stdout/stderr
     "TestFly Appium" çıktı kanalına yazılır.
  3. Port doluysa ve `/status` yanıt vermiyorsa açık bir hata gösterilir ("4723 portu başka bir süreçte").
- **Durdurma:** Yalnızca kendi başlattığımız süreç kapatılır. Panel kapanınca ve uzantı `deactivate` olunca da kapatılır.
- **Ön koşul kontrolü** (kurulum yapılmaz, yalnızca yönerge gösterilir):
  - `appium --version` çalışmıyorsa kurulum yönergesi gösterilir: `npm i -g appium`, Node sürüm koşulu.
  - `appium driver list --installed --json` ile `uiautomator2` ve `xcuitest` sürücülerinin yüklü olup olmadığı ve
    sürümleri kontrol edilir. Eksik olan için `appium driver install uiautomator2` gibi bir yönerge gösterilir.
- **Platform farkları (`process.ts`):**
  - **macOS ve Linux:** `spawn(appiumPath, args)` kabuksuz çalıştırılır. Durdurmak için süreç grubuna `SIGTERM`,
    5 sn sonra hâlâ yaşıyorsa `SIGKILL` gönderilir (`detached: true` ve `process.kill(-pid)`).
  - **Windows:** `appium` aslında `appium.cmd` dosyasıdır. Node 18.20.2 ve sonrasında `.cmd` dosyası kabuksuz
    `spawn`/`execFile` ile çalıştırılırsa `EINVAL` hatası verir. Bu yüzden önce `where appium` ile yol bulunur. Bulunan bir
    `.cmd` ise ona karşılık gelen `node_modules/appium/index.js` dosyası `process.execPath` değil sistem `node`'u ile
    çalıştırılır. O bulunamazsa `shell: true` ile ve argümanlar kaçışlanarak çalıştırılır. Durdurmak için
    `taskkill /PID <pid> /T /F` kullanılır.
  - **PATH:** VS Code, kabuktaki PATH'i her zaman almaz (özellikle macOS'ta Dock'tan açıldığında). `appium`, `adb` ve
    `xcrun` bulunamazsa giriş kabuğunda (`$SHELL -lc 'command -v appium'`) bir kez aranır ve sonuç önbelleğe alınır.
    `ANDROID_HOME`/`ANDROID_SDK_ROOT` yoksa uyarı gösterilir, çünkü UiAutomator2 bunlara ihtiyaç duyar.

## 8. Cihaz keşfi (`devices/*`)

Bütün komutlar `execFile` ile (kabuksuz, argüman dizisiyle) ve zaman aşımıyla çalıştırılır. Araç bulunamazsa o kaynak
"araç bulunamadı" notuyla atlanır.

| Kaynak | Komut | Çıktı |
|---|---|---|
| Android | `adb devices -l`, ardından her cihaz için `adb -s <id> shell getprop` (tek çağrı, bütün özellikler) | `id`, `name` (`ro.product.model`), `platform: android`, `type: emulator`/`real`, `version` (`ro.build.version.release`), `state` |
| iOS simülatör | `xcrun simctl list devices --json` | Yalnızca `isAvailable` olanlar. `Booted` olanlar hazırdır; `Shutdown` olanlar için "Boot" düğmesi (`xcrun simctl boot <udid>`) |
| iOS gerçek cihaz | `xcrun devicectl list devices --json-output <geçici dosya>` (Xcode 15+), yedek olarak `xcrun xctrace list devices` | `udid` = `hardwareProperties.udid`, ad, sürüm |

Dikkat edilecekler:

- Android `unauthorized` ve `offline` durumundaki cihazlar listelenir ama seçilemez; nedeni gösterilir.
- Gerçek iOS'ta `devicectl`'in kimliği (CoreDevice UUID) ile Appium'un `appium:udid` değeri (donanım UDID'si) farklıdır.
  `hardwareProperties.udid` kullanılır. Bu **doğrulanacak**, çünkü elimizde gerçek cihaz yok (Bölüm 19).
- Liste "Reload" düğmesiyle, sunucu başlatıldıktan sonra ve panel görünür olup odak aldığında yenilenir. Arka planda
  zamanlayıcıyla yoklama yapılmaz.
- Windows ve Linux'ta iOS kaynakları hiç denenmez.
- Ayrıştırıcılar saf fonksiyonlardır ve gerçek komut çıktılarından alınmış fixture'larla test edilir.

## 9. Uygulama girişi ve capabilities

### 9.1 Uygulama kipleri

1. **Dosya:** `.apk` (Android), `.app` klasörü (simülatör), `.ipa` (gerçek iOS). VS Code `showOpenDialog` ile seçilir.
   Uzantı platformla uyuşmuyorsa uyarı gösterilir. Capability: `appium:app` (mutlak yol).
2. **Yüklü uygulama:** Android'de `appium:appPackage` (ve isteğe bağlı `appium:appActivity`), iOS'ta `appium:bundleId`.
3. **Uygulama yok (o anki ekran):** Hiçbir uygulama capability'si verilmez.
   - iOS: XCUITest 12.20'nin kaynağında bu durum açıkça destekleniyor ("WebDriverAgent will be started without the default
     app"). `com.apple.springboard` hilesine gerek yok.
   - Android: UiAutomator2, uygulama capability'si olmadan o anki ekranla oturum açar.
   - İkisi de Faz 2'de cihazda **doğrulanacak**.

### 9.2 Capabilities üretimi (`appium/capabilities.ts`, saf fonksiyon, test edilir)

| Alan | Android (UiAutomator2) | iOS simülatör (XCUITest) | iOS gerçek cihaz |
|---|---|---|---|
| `platformName` | `Android` | `iOS` | `iOS` |
| `appium:automationName` | `UiAutomator2` | `XCUITest` | `XCUITest` |
| `appium:udid` | adb kimliği | simülatör UDID'si | donanım UDID'si |
| `appium:deviceName` | model adı | simülatör adı | cihaz adı |
| `appium:platformVersion` | sürüm | sürüm | sürüm |
| `appium:newCommandTimeout` | 600 | 600 | 600 |
| `appium:noReset` | `true` | `true` | `true` |
| Ek | | | `appium:xcodeOrgId`, `appium:xcodeSigningId` (varsayılan `Apple Development`), isteğe bağlı `appium:updatedWDABundleId` |

- Varsayılan olarak kullanıcının uygulamasına dokunulmaz: `noReset: true`. Oturum kapanırken uygulamanın kapatılmaması için
  `appium:shouldTerminateApp: false` (her iki sürücüde de var) eklenir. Davranış Faz 2'de **doğrulanacak**.
- **Gelişmiş kip:** Ham capabilities JSON düzenleyicisi bulunur. Formdan üretilen değerler bu JSON ile birleştirilir; JSON
  önceliklidir. Ayar profilleri `globalState`'e kaydedilir.
- iOS gerçek cihaz için imzalama değerleri ayarlarda (`ios.xcodeOrgId`, `ios.xcodeSigningId`) tutulur. Eksikse oturum
  açma hatası, imzalama yönergesiyle birlikte gösterilir.

### 9.3 Oturum sonrası ayarlar

- Android: Gerekirse `appium/settings` ile `{ "ignoreUnimportantViews": false }`.
- iOS: Büyük ağaçlarda `{ "snapshotMaxDepth": N }` (varsayılan 50; arayüzden değiştirilebilir).
- Ayarlar, oturum panelindeki "Settings" bölümünden okunur ve yazılır.

## 10. Page source ve ağaç

### 10.1 Girdi

Appium'un XML page source'udur.

- **Android (UiAutomator2):** Kök `hierarchy`. İç düğümlerin etiket adı sınıf adıdır (`android.widget.Button`).
  Öznitelikler: `index`, `package`, `class`, `text`, `resource-id`, `content-desc`, `checkable`, `checked`, `clickable`,
  `enabled`, `focusable`, `focused`, `long-clickable`, `password`, `scrollable`, `selected`, `bounds="[x1,y1][x2,y2]"`,
  `displayed`, `hint` ve sürüme göre başka alanlar.
- **iOS (XCUITest):** Kök `AppiumAUT`. Etiket adı `XCUIElementType*`. Öznitelikler: `type`, `name`, `label`, `value`,
  `enabled`, `visible`, `accessible`, `x`, `y`, `width`, `height`, `index`, `placeholderValue`, `traits` ve sürüme göre
  başka alanlar.

Bütün öznitelikler Attributes panelinde **ham haliyle** gösterilir. Bilinmeyen öznitelikler de kaybolmaz.

### 10.2 Görünüm modeli

Webview, DOM düğümünden şu görünüm alanlarını türetir (`ref` yoktur):

```ts
interface ElementView {
  node: Element;                       // DOMParser düğümü; XPath ve öznitelikler buradan
  platform: 'android' | 'ios';
  type: string;                        // android.widget.Button | XCUIElementTypeButton
  title: string;                       // ağaçta gösterilecek kısa metin (text/label/name/content-desc)
  rect?: { x: number; y: number; width: number; height: number };   // window/rect biriminde
}
```

### 10.3 Ölçek

- Android `bounds` ve ekran görüntüsü pikseldir; `window/rect` de pikseldir.
- iOS `x/y/width/height` ve `window/rect` point'tir; ekran görüntüsü pikseldir.
- Webview, overlay'i `rect / window.rect` yüzdesiyle yerleştirir. Bu, birimden bağımsızdır; mevcut yüzdelik yerleştirme
  mantığı korunur.
- Android'de yatay ekran ve kesik (notch) durumunda `window/rect` ile ekran görüntüsünün en-boy oranı farklı olabilir.
  Fark %2'yi aşarsa uyarı gösterilir. Faz 2'de **doğrulanacak**.

### 10.4 Sağlamlık

- Host, ham XML'deki geçersiz kontrol karakterlerini temizler.
- `DOMParser` `parsererror` döndürürse "Page source okunamadı" hatası gösterilir. Ham XML, Page Source sekmesinde
  kopyalanabilir halde kalır.
- 5000'den fazla düğümü olan ağaçlarda ağaç görünümü tembel açılır (yalnızca açılan dallar çizilir) ve iOS için
  `snapshotMaxDepth` önerisi gösterilir.

## 11. Mobil locator'lar (`media/locators.js`)

### 11.1 Android önerileri (sırayla)

| Strateji | W3C `using` | Örnek değer | Yerel sayım |
|---|---|---|---|
| id | `id` | `com.app:id/btnLogin` | Evet: `resource-id` eşitliği. Paket öneki yoksa uygulama paketi eklenir; Appium da bunu yapar |
| accessibility id | `accessibility id` | `Login` | Evet: `content-desc` eşitliği |
| UiAutomator | `-android uiautomator` | `new UiSelector().resourceId("…")`, `.description("…")`, `.text("…")`; gerekirse `.className("…").instance(n)` | Yalnızca bu basit biçimler; değilse "?" |
| class name | `class name` | `android.widget.EditText` | Evet |
| xpath | `xpath` | `//android.widget.Button[@text='Sign in']` | Evet (`document.evaluate`) |

### 11.2 iOS önerileri (sırayla)

| Strateji | W3C `using` | Örnek değer | Yerel sayım |
|---|---|---|---|
| accessibility id | `accessibility id` | `loginButton` (`name`) | Evet: `name` eşitliği |
| predicate | `-ios predicate string` | `label == 'Sign in'`, `type == 'XCUIElementTypeButton' AND name == 'x'` | Yalnızca `==` ve `AND` içeren basit biçimler; değilse "?" |
| class chain | `-ios class chain` | ``**/XCUIElementTypeButton[`label == 'Sign in'`]`` | Yalnızca tek seviyeli basit biçim; değilse "?" |
| class name | `class name` | `XCUIElementTypeButton` | Evet |
| xpath | `xpath` | `//XCUIElementTypeButton[@name='login']` | Evet |

### 11.3 Eşleşme sayısı ve Verify

- Yerel sayım, webview'daki DOM üzerinde anında yapılır.
- Her önerinin yanında **Verify** düğmesi bulunur. Webview isteği host'a iletir, host da `POST /elements` çağırır. Sonuç
  "✓ unique", "N matches" ya da "no match" olarak gösterilir. Sunucunun sonucu her zaman yerel sayımın önüne geçer.
- Benzersiz öneriler en üstte sıralanır (mevcut davranış).
- Yerel sayım ile sunucu sayısı farklı çıkarsa öneri satırında "⚠ server: N" gösterilir.

### 11.4 Kaçış

- **Java dizgesi:** `\`, `"`, satır sonu, sekme ve `\uXXXX` olarak kontrol karakterleri.
- **XPath:** Değer `'` içeriyorsa `"…"` kullanılır; ikisini de içeriyorsa `concat()` (mevcut `quote()` mantığı).
- **Predicate:** `'` ve `\` kaçışlanır.
- **Class chain:** Backtick içeren değerler için class chain önerilmez.
- **UiSelector:** `"` ve `\` kaçışlanır. Değer, Java dizgesi içinde ikinci kez kaçışlanır.

Her biçim için ayrı test yazılır (Bölüm 17).

### 11.5 Bulucu (finder)

Stratejiler Appium Inspector ile aynıdır: `id`, `accessibility id`, `xpath`, `class name`, `-android uiautomator`,
`-ios predicate string`, `-ios class chain`.

- İlk dördü yerelde çalışır.
- Diğer üçü için yerelde basit biçimler denenir; sonuç her zaman Verify (sunucu) ile kesinleştirilir.
- "Search" düğmesi sunucudan dönen elementleri `rect` ile ağaçta işaretler.

## 12. Java çıktısı (mobil, `media/codegen.js`)

### 12.1 Hedef seçimi

`codegen.javaClient` ayarı:

| Değer | Java hedefi | PageFactory import'u | Kullanıcının projesinde gereken bağımlılıklar |
|---|---|---|---|
| `11` (varsayılan) | java-client 11.x, Selenium ≥ 4.50 | `io.appium.java_client.support.PageFactory` | `io.appium:java-client:11.x`, ayrıca `selenium-api` geçişli olarak gelir |
| `9-10` | java-client 9.x/10.x, Selenium 4.x | `org.openqa.selenium.support.PageFactory` | `io.appium:java-client:10.x` (selenium-support geçişli olarak gelir) |

`codegen.style` ayarı:

- `pageFactory` (varsayılan): `@AndroidFindBy`/`@iOSXCUITFindBy` alanları.
- `appiumBy`: `private static final By X = AppiumBy.id("…");` sabitleri. `AppiumBy` her iki hedefte de aynıdır.

### 12.2 Strateji eşlemesi

| Strateji | `@AndroidFindBy` | `@iOSXCUITFindBy` | `AppiumBy` |
|---|---|---|---|
| id | `id = "…"` | `id = "…"` | `AppiumBy.id("…")` |
| accessibility id | `accessibility = "…"` | `accessibility = "…"` | `AppiumBy.accessibilityId("…")` |
| UiAutomator | `uiAutomator = "…"` | | `AppiumBy.androidUIAutomator("…")` |
| predicate | | `iOSNsPredicate = "…"` | `AppiumBy.iOSNsPredicateString("…")` |
| class chain | | `iOSClassChain = "…"` | `AppiumBy.iOSClassChain("…")` |
| class name | `className = "…"` | `className = "…"` | `AppiumBy.className("…")` |
| xpath | `xpath = "…"` | `xpath = "…"` | `AppiumBy.xpath("…")` ya da `By.xpath("…")` |

Annotation üyeleri ve `AppiumBy` fabrika metotları java-client 11.0.0 jar'ından `javap` ile doğrulandı.

### 12.3 Tek alan

```java
@AndroidFindBy(id = "com.app:id/btnLogin")
@iOSXCUITFindBy(accessibility = "loginButton")
private WebElement btnLogin;
```

- İlk sürümde yalnızca aktif oturumun platformu üretilir.
- Faz 7'de "iki platformu birleştir" eklenir: kullanıcı aynı ekranı iki platformda incelediyse iki annotation tek alanda
  birleşir.

### 12.4 Alan adı üretimi

- Kaynak sırası: `resource-id`'nin son parçası, accessibility id, text/label, tür ve sıra.
- camelCase'e çevrilir; Java tanımlayıcısı olmayan karakterler atılır; rakamla başlıyorsa önüne `el` eklenir.
- Java anahtar kelimeleriyle (`class`, `new`, `default`, ...) çakışırsa sonuna `Element` eklenir.
- Aynı sınıfta tekrar ederse `2`, `3`, ... soneki eklenir.
- Hepsi test edilir.

### 12.5 Record sınıfı

java-client 11 hedefi için:

```java
import io.appium.java_client.AppiumDriver;
import io.appium.java_client.pagefactory.AndroidFindBy;
import io.appium.java_client.pagefactory.AppiumFieldDecorator;
import io.appium.java_client.support.PageFactory;
import java.util.Map;
import org.openqa.selenium.WebElement;

public class RecordedPage {
    private final AppiumDriver driver;

    @AndroidFindBy(id = "com.app:id/etUser")
    private WebElement etUser;

    @AndroidFindBy(id = "com.app:id/btnLogin")
    private WebElement btnLogin;

    public RecordedPage(AppiumDriver driver) {
        this.driver = driver;
        PageFactory.initElements(new AppiumFieldDecorator(driver), this);
    }

    public void recordedFlow() {
        etUser.sendKeys("ada");
        btnLogin.click();
        driver.executeScript("mobile: dragGesture", Map.of(
                "startX", 540, "startY", 1600, "endX", 540, "endY", 600));
        driver.navigate().back();
    }
}
```

- 9-10 hedefinde yalnızca `PageFactory` import'u değişir: `org.openqa.selenium.support.PageFactory`.
- Element üzerindeki adımlar `click()`, `sendKeys()` ve `clear()` olarak yazılır.
- Koordinat adımları (swipe, boşluğa dokunma) platforma göre `mobile:` komutuyla yazılır (Bölüm 6.4 tablosu). Koordinatlar
  kayıt anındaki ekran boyutuna göredir; bunu bir yorum satırı belirtir.
- Geri adımı `driver.navigate().back()` olarak, Home adımı `mobile: pressKey` ya da `mobile: pressButton` olarak yazılır.
- `TouchAction` hiçbir hedefte kullanılmaz.
- Import'lar yalnızca kullanılan sınıflar için ve alfabetik sırada üretilir.

## 13. Browser Inspector'dan Selenium Inspector'a

- CDP ile sürme (`browserPanel.ts`, `cdp.ts`, `browsers.ts`) **değişmez**.
- `page-agent.js` locator önerileri Selenium 4.x stratejilerine çevrilir. Sıra şöyledir:

| # | Ne zaman | `@FindBy` | `By` |
|---|---|---|---|
| 1 | Benzersiz `id` | `@FindBy(id = "x")` | `By.id("x")` |
| 2 | Benzersiz `name` | `@FindBy(name = "x")` | `By.name("x")` |
| 3 | Test id özniteliği (`testIdAttribute` ayarı) | `@FindBy(css = "[data-testid='x']")` | `By.cssSelector("[data-testid='x']")` |
| 4 | `aria-label`, `placeholder`, `title`, `alt` | `@FindBy(css = "input[placeholder='E-mail']")` | `By.cssSelector(…)` |
| 5 | `<a>` ve benzersiz metin | `@FindBy(linkText = "…")` / `partialLinkText` | `By.linkText(…)` / `By.partialLinkText(…)` |
| 6 | Benzersiz kısa CSS | `@FindBy(css = "…")` | `By.cssSelector(…)` |
| 7 | Metin tabanlı XPath | `@FindBy(xpath = "//button[normalize-space()='Sign in']")` | `By.xpath(…)` |

- **Sayım:** Sayfada hesaplanır (mevcut mantık). `linkText` sayımı Selenium'un kuralına göre yapılır: görünen metin, kırpılmış
  ve tam eşitlik. Rol tablosu ve erişilebilir ad hesabı yalnızca **ağaçta element adını göstermek** için kalır; locator
  üretiminde kullanılmaz.
- **iframe:** Element bir iframe içindeyse çıktının başına bir yorum ve
  `driver.switchTo().frame(driver.findElement(By.cssSelector("…")));` satırı eklenir.
- **Shadow DOM:** Element açık (open) bir shadow root içindeyse XPath önerilmez. Çıktı Selenium 4'ün `getShadowRoot()` API'si
  ile yazılır:
  `driver.findElement(By.cssSelector("my-host")).getShadowRoot().findElement(By.cssSelector("button"))`.
  Kapalı (closed) shadow root için uyarı gösterilir.
- **Alan çıktısı:** `@FindBy(…) private WebElement signIn;` ve sınıf iskeletinde `PageFactory.initElements(driver, this);`
  (`org.openqa.selenium.support.PageFactory`, `selenium-java` 4.x). `codegen.style = by` seçilirse
  `private static final By SIGN_IN = By.id("…");` üretilir.
- Selenium 4.x'te `@FindBy`, `By.*`, `getShadowRoot()` ve `switchTo().frame()` bulunur, dolayısıyla çıktı her 4.x sürümünde
  derlenir. Bu, Faz 5'te 4.0.0 ve 4.51.0 ile derlenerek **doğrulanacak**.
- **Silinecek testler:** `test/browser.test.js` ve `test/selectors.test.js` içinde TestFly monorepo dosyalarını okuyan
  "mirror" testleri kaldırılır.
- Tarayıcıyı WebDriver ile sürmek kapsam **dışıdır**.

## 14. Arayüz

### 14.1 Araç çubuğu

- **Appium durum düğmesi:** Start/Stop, port ve sunucu sürümü; kırmızı (kapalı), sarı (başlıyor), yeşil (hazır).
  "Bağlı (harici)" durumu ayrıca gösterilir.
- **Cihaz seçici:** Otomatik liste, "Reload", platform rozeti, durum (unauthorized/offline/Shutdown).
- Inspect, Tap ve Record kipleri ile Back, Home ve Swipe düğmeleri korunur. iOS'ta Back düğmesi devre dışıdır.
- **Refresh:** Oturum açıkken ekranı ve source'u yeniler. Bir eylemden sonra `autoRefreshAfterAction` açıksa kendiliğinden
  yenilenir.

### 14.2 Oturum paneli (oturum yokken görünür)

- Uygulama kipi: Dosya / Yüklü uygulama / Yok.
- Dosya seç düğmesi, `appPackage`/`appActivity` ya da `bundleId` alanları.
- "Advanced capabilities (JSON)" düzenleyicisi ve üretilen capabilities'in canlı önizlemesi.
- **Start session / End session** düğmeleri, kayıtlı profiller (kaydet, yükle, sil).
- Oturum açılırken bir ilerleme göstergesi ve sunucu logunun son satırı gösterilir. İlk WDA derlemesi dakikalar sürebilir.

### 14.3 Sekmeler

- **UI Tree:** Ağaç, arama ve seçim.
- **Page Source:** Ham XML, sözdizimi renklendirme ve Kopyala. Eski Snapshot sekmesinin yerine gelir.
- **Recorded:** Kaydedilen adımlar ve üretilen sınıf; Kopyala, "Open as Java file".

### 14.4 Element paneli

- `ref` rozeti ve "Copy CLI tap" kalkar.
- Bütün öznitelikler tablo halinde gösterilir, ayrıca "Copy XPath" düğmesi bulunur.
- Locator listesi (Bölüm 11): her satırda Copy, "Copy as field", "Copy as By" ve Verify.
- Eylemler: Tap, Long press, Type (element bulunup `sendKeys`; bulunamazsa odaktaki alana yazılır), Clear.

### 14.5 Genel

- Tek etkin oturum vardır. İkinci bir panel açılırsa mevcut panel öne getirilir.
- Kenar çubuğunda Mobil/Browser seçimi kalır. Metinler "TestFly - Appium Inspector"e göre güncellenir.

## 15. Ayarlar, komutlar ve yeniden adlandırma

### 15.1 Kimlik

| Eski | Yeni |
|---|---|
| `name`: `testfly-mobile-inspector` | `testfly-appium-inspector` |
| `displayName`: TestFly Inspector | TestFly - Appium Inspector |
| Komutlar `testflyInspector.*` | `testflyAppiumInspector.open`, `.openBrowser`, `.startServer`, `.stopServer` |
| Ayarlar `testflyInspector.*` | `testflyAppiumInspector.*` (tek ad alanı; Selenium ayarları da burada) |
| View container ve id `testflyInspector` | `testflyAppiumInspector`, `testflyAppiumInspector.home` |
| `globalState` anahtarları | `testflyAppiumInspector.recentUrls`, `testflyAppiumInspector.profiles` |
| Sürüm `0.3.2` | `0.1.0` |
| `repository` | `https://github.com/hakanngul/AppiumInspectorExtensions.git` |
| `keywords` | `mobilecli` çıkar; `selenium`, `pagefactory`, `uiautomator2`, `xcuitest` eklenir |
| `dist/testfly-mobile-inspector-0.3.2.vsix` | Silinir; `.vsix` artık depoya konmaz |
| README.md, README_tr.md | Baştan yazılır; ikisi aynı içerikte tutulur |

`name` değişince uzantı kimliği (`hakanngul.testfly-appium-inspector`) de değişir. Bu, yeni bir uzantı demektir. Eski
ayarlar taşınmaz; README bunu belirtir.

### 15.2 Ayarlar (`testflyAppiumInspector.*`)

| Ayar | Varsayılan | Açıklama |
|---|---|---|
| `appium.path` | `appium` | Appium çalıştırılabilir dosyası |
| `appium.host` | `127.0.0.1` | Başlatılan sunucunun adresi |
| `appium.port` | `4723` | Port |
| `appium.basePath` | `/` | `--base-path` |
| `appium.allowCors` | `true` | `--allow-cors` eklenir |
| `appium.autoStart` | `false` | Panel açılınca sunucuyu başlat |
| `appium.serverUrl` | (boş) | Faz 7: uzak sunucu |
| `adbPath` | (boş: PATH ya da `ANDROID_HOME`) | |
| `ios.xcodeOrgId`, `ios.xcodeSigningId` | (boş), `Apple Development` | Gerçek iOS imzalama |
| `autoRefreshAfterAction` | `true` | |
| `codegen.javaClient` | `11` | `11` ya da `9-10` |
| `codegen.style` | `pageFactory` | `pageFactory`, `appiumBy` (mobil); `pageFactory`, `by` (browser) |
| `browserPath` | (boş) | Chrome, Edge ya da Chromium |
| `testIdAttribute` | `data-testid` | Browser test id özniteliği |

**Kaldırılanlar:** `serverUrl` (mobilecli), `mobilecliPath`, `autoStartServer`.

**Küçük düzeltme:** `.vscodeignore` dosyasındaki `LICENSE.txt` satırı kaldırılır, çünkü gerçek dosya adı `LICENSE` ve
paketlenmesi gerekir. `test/java/**` satırı eklenir.

## 16. Fazlar ve kabul ölçütleri

Her fazın sonunda `npm run build` ve `npm test` çalıştırılır. İkisinden biri geçmezse faz tamamlanmış sayılmaz. Her faz ayrı
bir commit ile `AppiumInspectorExtensions` deposuna gider.

### Faz 0: Hazırlık

- Mevcut uzantı klasörü `AppiumInspectorExtensions` deposuna kopyalanır ve **değiştirilmeden** ilk commit olarak atılır.
  Bu, tek geri dönüş noktasıdır.
- `npm ci` ve `npm test` çalıştırılır; sonuç taban çizgisi olarak commit mesajına yazılır.
- Ortam kontrolü: `node -v` (≥ 20.19), `appium -v` (3.x), `appium driver list --installed`, `adb version`,
  `xcrun simctl help`.
- Gerçek fixture'lar toplanır: `adb devices -l`, `getprop`, `simctl list devices --json`. Appium elle başlatılıp
  Android emülatörden ve iOS simülatörden page source, ekran görüntüsü ve `window/rect` alınır.
- **Çıktı:** `test/fixtures/*`, taban çizgisi test sonucu, ortam sürümleri.

### Faz 1: Çekirdek (arayüz yok, tamamen testli)

- `appium/client.ts`, `appium/capabilities.ts`, `devices/*`, `apps.ts`, `process.ts`, host tarafı `sanitizeXml`.
- İstemci sahte bir W3C sunucusuyla test edilir; ayrıştırıcılar fixture'larla test edilir.
- **Kabul:** Testler yeşil. Android ve iOS fixture'larında düğüm sayısı ve `rect` değerleri elle kontrol edilmiş.

### Faz 2: Sunucu, oturum ve extension host

- `appium/server.ts`, `session.ts`, `gestures.ts`, `extension.ts` yeniden yazımı, webview ile host arasındaki mesaj
  protokolü.
- Bölüm 19'daki "Faz 2'de doğrulanacak" maddeleri cihazda denenir ve sonuçları bu belgeye işlenir.
- **Kabul:** Uzantıdan Appium başlatılır. Emülatör ve simülatör listelenir. Her iki platformda oturum açılıp ekran ve source
  gelir. Tap, swipe, type, back ve home çalışır. Uygulamasız oturum açılır. Windows makinesinde `.vsix` kurulur; Appium başlatılır,
  durdurulur (süreç ağacı kalmaz) ve Android oturumu açılır.

### Faz 3: Mobil webview

- `body.html`, `inspector.js/css`, oturum paneli, Page Source sekmesi, `ref` temizliği, `DOMParser` tabanlı ağaç, finder.
- **Kabul:** Bir elemente tıklayınca doğru düğüm ve öznitelikler görünür. Overlay her iki platformda elementle örtüşür.
  Playwright önizleme testi (sahte host) yeşil.

### Faz 4: Mobil locator'lar, Java çıktısı ve Record

- `media/locators.js`, `media/codegen.js`, Verify, alan adı üretimi, Record sınıfı.
- **Kabul:**
  - Üretilen kod `test/java` Maven projesinde **hem** java-client 11.0.0 **hem** 10.1.1 ile `mvn -q compile`'dan geçer.
  - En az bir Android ve bir iOS ekranı için önerilen locator'lar cihazda `findElements` ile doğrulanır; yerel sayımla
    sunucu sayısı uyuşur.

### Faz 5: Browser'dan Selenium'a

- `page-agent.js` locator'ları, `browser.js` çıktısı, iframe ve shadow DOM çıktısı, TestFly'a bağlı testlerin temizliği.
- **Kabul:** `npm test` (tarayıcı testi dahil) yeşil. Üretilen `@FindBy` ve `By` kodu `test/java` içinde Selenium 4.0.0 ve
  4.51.0 ile derlenir. Örnek bir sayfada (`test/fixtures/page.html`) elementi bulur.
- Bu faz mobil fazlardan bağımsızdır; istenirse Faz 1'den önce yapılabilir.

### Faz 6: Yeniden adlandırma ve paketleme

- `package.json`, ayar ve komut kimlikleri, kenar çubuğu metinleri, README (TR ve EN), ikon ve etkinlik çubuğu metinleri,
  `.vscodeignore`.
- **Kabul:** `npm run package` bir `.vsix` üretir. Bu paket temiz bir VS Code profiline kurulur; komutlar ve ayarlar görünür;
  `mobilecli` kelimesi paketin hiçbir yerinde geçmez.

### Faz 7 (sonra)

Uzak sunucu ve bulut sağlayıcılar, çalışan bir oturuma bağlanma, iki platformu tek alanda birleştirme, WebView context.

## 17. Test stratejisi

| Katman | Yöntem | Kapsam |
|---|---|---|
| `client.ts` | `node:test` ve sahte W3C HTTP sunucusu | Hata biçimi, zaman aşımı, unreachable, invalid session, base path |
| `server.ts`, `process.ts` | Sahte `appium` betiği (Node ile yazılmış sahte süreç) | Başlatma, hazır olma, port dolu, durdurma, harici sunucuyu durdurmama |
| `capabilities.ts` | `node:test` | Üç platform, üç uygulama kipi, gelişmiş JSON birleştirme |
| `devices/*` | Komut çıktısı fixture'ları | `adb`, `simctl`, `devicectl`, `xctrace` ayrıştırma; bozuk ve boş çıktı |
| `gestures.ts` | Sahte sunucu | W3C Actions gövdesi; `/appium/extensions` sonucuna göre yedek komut seçimi |
| `locators.js` | `node:test` ve `test/xml.js` okuyucusu | Öneri sırası, yerel sayım, kaçış, basit predicate/class chain/UiSelector sayımı |
| `codegen.js` | `node:test`, metin karşılaştırması | İki java-client hedefi, iki stil, alan adı üretimi, Record, import'lar |
| Java derleme | `test/java` Maven projesi (`mvn -q compile`, profiller: `jc11`, `jc10`, `sel40`, `sel451`) | Üretilen kodun derlendiğini kanıtlar; elle çalışır (CI yok), `npm test`'in parçası değildir |
| Webview | `test/preview.js` (Playwright, sahte host ve fixture XML) | Ağaç, overlay, XPath sayımı, finder |
| Uçtan uca | Elle: emülatör ve simülatör | Yalnızca burada kanıtlanan şey "doğrulandı" diye raporlanır |

## 18. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| iOS page source çok yavaş ya da çok büyük | Donma, zaman aşımı | 120 sn zaman aşımı, ilerleme göstergesi, `snapshotMaxDepth`, tembel ağaç |
| İlk iOS oturumunda WDA derlemesi | Oturum dakikalarca açılmaz | 300 sn zaman aşımı, sunucu logunun son satırını gösterme |
| Point ile piksel farkı, yatay ekran, notch | Overlay kayar | Yüzdelik yerleştirme, en-boy oranı uyarısı |
| Sürücü sürümünde komut farkı | Hareket çalışmaz | W3C Actions birincil; `/appium/extensions` ile yetenek algılama; açık hata |
| java-client 10 ile 11 arasındaki farklar | Üretilen kod derlenmez | `codegen.javaClient` ayarı, iki hedefe karşı derleme testi |
| Gerçek iOS: WDA imzalama, UDID eşleşmesi | Oturum açılmaz | Ayarlar ve yönergeli hata; **bu makinede test edilemez** |
| UiAutomator, predicate ve class chain yerelde sayılamaz | Yanlış güven | "?" gösterme, Verify ile sunucuda kesinleştirme |
| Bozuk XML | Ağaç gelmez | Karakter temizleme, ham XML'i gösterme |
| Windows'ta `.cmd` ve süreç ağacı | Başlatılamaz ya da zombi süreç kalır | `process.ts`: `where` ile yol bulma, `taskkill /T` |
| VS Code'un PATH'i eksik | "appium bulunamadı" | Ayardan yol verme, giriş kabuğunda arama, `ANDROID_HOME` uyarısı |
| `newCommandTimeout` dolması | `invalid session id` | Algılama ve "yeniden başlat" mesajı |
| Aynı anda iki panel ya da oturum | Çakışma | Tek etkin oturum |
| Tekrarlanan `spawn` | Zombi süreç | Tek süreç tutucu, `deactivate`'te temizlik |
| Appium 2 kullanıcıları | Beklenmeyen davranış | `/status` sürümünü okuyup uyarı |

## 19. Doğrulanamayacak ve doğrulanacak şeyler

**Bu belgede doğrulandı** (25 Ekim 2026, kaynak kod ve paket deposu):

- Sürümler (Bölüm 3) ve java-client 11'in kırıcı değişiklikleri.
- Sunucu endpoint'leri ve Appium 3.8 CLI bayrakları.
- `mobile:` komut adları ve parametreleri (Bölüm 6.4).
- Annotation üyeleri ve `AppiumBy` metotları.
- XCUITest'in uygulamasız oturum desteği (kaynakta).

**Faz 2'de cihazda doğrulanacak** (Appium 3.8.0, UiAutomator2 8.7.0, XCUITest 12.20.0):

- Uygulamasız oturumun her iki platformda açılması.
- `noReset` ile `shouldTerminateApp: false` birlikteyken uygulamanın açık kalması.
- W3C Actions ile tap, long press ve swipe davranışı.
- `mobile: type` ve `mobile: keys` ile odaktaki alana yazma.
- iOS point/piksel ölçeği ve Android yatay ekran.

**Faz 4 ve 5'te derlenerek doğrulanacak:** Üretilen Java'nın java-client 11.0.0 ve 10.1.1 ile, Selenium 4.0.0 ve 4.51.0 ile
derlenmesi. Bundan önce "derlenir" denmeyecek.

**Doğrulanamayacak:**

- Gerçek iOS cihaz: iPhone ve Apple ID sağlanana kadar `devicectl` ayrıştırması yalnızca fixture ile test edilir; oturum
  açma doğrulanamaz ve öyle raporlanır (Bölüm 20.1).

**Kullanıcının makinesinde elle doğrulanacak:** Windows'ta Android (Faz 2).

## 20. Kararlar

**Verilmiş kararlar:**

1. Sürüm `0.1.0` (yeni ürün; cihazda doğrulanana kadar 1.0 denmez).
2. Depo `hakanngul/AppiumInspectorExtensions`. Faz 0'da mevcut hal ilk commit olarak atılır.
3. Java hedefi java-client 11.x (varsayılan) ve 9.x/10.x. Selenium 4.x.
4. Sunucu Appium 3.x; sürücüler UiAutomator2 8.x ve XCUITest 12.x.
5. Hareketlerde birincil yol W3C Actions.
6. XML tek yerde (webview'da `DOMParser` ile) ayrıştırılır.
7. Tarayıcıyı Selenium ile sürmek kapsam dışı; yalnızca çıktı Selenium.

8. Windows'ta Android, kullanıcının Windows makinesinde Faz 2'de elle doğrulanır.
9. `test/java` derleme kontrolü CI'a bağlanmaz; Faz 4 ve 5'te elle çalıştırılır (`mvn -q compile`).

**Açık kalan kararlar:**

1. Gerçek iOS cihaz testi: bir iPhone ve Xcode'a eklenmiş bir Apple ID var mı? Ücretsiz Apple ID yeterlidir; ücretli Apple
   Developer Program şart değildir (ayrıntı: Bölüm 20.1).

### 20.1 Gerçek iOS cihaz için gerekenler

Appium, gerçek iPhone'a WebDriverAgent (WDA) adlı bir test uygulaması kurar. iOS imzasız uygulama çalıştırmadığı için WDA'nın
bir Apple hesabıyla imzalanması gerekir. Simülatörde imza gerekmez.

| Gereken | Ücretsiz Apple ID | Ücretli Apple Developer Program |
|---|---|---|
| Xcode > Settings > Accounts'a eklenmiş hesap | Evet | Evet |
| `appium:xcodeOrgId` | Team ID (10 karakter, Xcode'da "Personal Team") | Team ID (developer.apple.com > Membership) |
| `appium:xcodeSigningId` | `Apple Development` | `Apple Development` |
| `appium:updatedWDABundleId` | **Gerekli**, size özgü olmalı (ör. `com.<ad>.WebDriverAgentRunner`) | İsteğe bağlı |
| Provisioning profilinin süresi | 7 gün, sonra WDA yeniden derlenir | 1 yıl |

Ayrıca: USB ile bağlı bir iPhone, iPhone'da "Bu bilgisayara güven" onayı ve Developer Mode açık olmalıdır
(Ayarlar > Gizlilik ve Güvenlik > Geliştirici Modu). Ücretsiz hesapta, WDA ilk kez kurulduğunda iPhone'da
Ayarlar > Genel > VPN ve Cihaz Yönetimi altından geliştiriciye güvenilmesi gerekir.

## 21. Faz 0 ve Faz 1 iş listesi

1. Uzantı klasörünü depoya kopyala, değiştirmeden commit at.
2. `npm ci` ve `npm test` çalıştır; taban çizgisini kaydet.
3. Ortam sürümlerini kaydet (`node`, `appium`, sürücüler, `adb`, Xcode).
4. Appium'u elle başlat. Android emülatörden ve iOS simülatörden page source, ekran görüntüsü ve `window/rect` alıp
   `test/fixtures` altına kaydet. Aynı şeyi `adb`, `simctl` ve (varsa) `devicectl` çıktıları için yap.
5. `client.ts` ve sahte W3C sunucu testleri.
6. `capabilities.ts` ve testleri.
7. `devices/*` ve fixture testleri.
8. `process.ts` ve sahte süreç testleri.
9. `sanitizeXml` ve `test/xml.js` okuyucusu.
