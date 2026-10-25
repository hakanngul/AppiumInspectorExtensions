const test = require('node:test');
const assert = require('node:assert');
const C = require('../media/codegen.js');

const id = { using: 'id', value: 'com.example.shop:id/sign_in' };
const email = { using: 'id', value: 'com.example.shop:id/email' };

test('Java string literals escape quotes, backslashes and control characters', () => {
    assert.strictEqual(C.javaString('a "b" \\ c'), '"a \\"b\\" \\\\ c"');
    assert.strictEqual(C.javaString('line\nnext\ttab'), '"line\\nnext\\ttab"');
    assert.strictEqual(C.javaString('\u0001\u2028'), '"\\u0001\\u2028"');
    assert.strictEqual(C.javaString('new UiSelector().text("Go")'), '"new UiSelector().text(\\"Go\\")"');
});

test('field names are camelCase Java identifiers, unique, never keywords', () => {
    const used = new Set();
    assert.strictEqual(C.fieldName({ words: 'sign_in', type: 'Button' }, used), 'signInButton');
    assert.strictEqual(C.fieldName({ words: 'sign_in', type: 'Button' }, used), 'signInButton2');
    assert.strictEqual(C.fieldName({ words: 'emailField', type: 'TextField' }, used), 'emailFieldTextField');
    assert.strictEqual(C.fieldName({ words: 'Add to cart', type: 'TextView' }, used), 'addToCartTextView');
    assert.strictEqual(C.fieldName({ words: '2nd step', type: 'Button' }, used), 'el2ndStepButton');
    assert.strictEqual(C.fieldName({ words: '', type: 'ImageView' }, used), 'imageView');
    assert.strictEqual(C.fieldName({ words: 'Çıkış', type: 'Button' }, used), 'cikisButton');
    assert.strictEqual(C.fieldName({ words: 'new', type: '' }, used), 'newElement');
    assert.strictEqual(C.fieldName({ words: 'loginButton', type: 'Button' }, used), 'loginButton');
    assert.strictEqual(C.constName('signInButton'), 'SIGN_IN_BUTTON');
});

test('one field per strategy, annotation member and By factory as in java-client', () => {
    const cases = [
        [{ using: 'id', value: 'x' }, '@AndroidFindBy(id = "x")', 'AppiumBy.id("x")'],
        [{ using: 'accessibility id', value: 'x' }, '@AndroidFindBy(accessibility = "x")', 'AppiumBy.accessibilityId("x")'],
        [{ using: '-android uiautomator', value: 'new UiSelector().text("x")' }, '@AndroidFindBy(uiAutomator = "new UiSelector().text(\\"x\\")")', 'AppiumBy.androidUIAutomator("new UiSelector().text(\\"x\\")")'],
        [{ using: 'class name', value: 'android.widget.Button' }, '@AndroidFindBy(className = "android.widget.Button")', 'AppiumBy.className("android.widget.Button")'],
        [{ using: 'xpath', value: "//a[@b='c']" }, '@AndroidFindBy(xpath = "//a[@b=\'c\']")', 'By.xpath("//a[@b=\'c\']")'],
    ];
    for (const [loc, ann, by] of cases) {
        assert.strictEqual(C.field(loc, { platform: 'android', style: 'pageFactory', name: 'go' }), ann + '\nprivate WebElement go;');
        assert.strictEqual(C.field(loc, { platform: 'android', style: 'appiumBy', name: 'goButton' }), 'private static final By GO_BUTTON = ' + by + ';');
    }
    assert.strictEqual(C.field({ using: '-ios predicate string', value: "label == 'Go'" }, { platform: 'ios', style: 'pageFactory', name: 'go' }),
        '@iOSXCUITFindBy(iOSNsPredicate = "label == \'Go\'")\nprivate WebElement go;');
    assert.strictEqual(C.field({ using: '-ios class chain', value: '**/XCUIElementTypeButton[`label == \'Go\'`]' }, { platform: 'ios', style: 'pageFactory', name: 'go' }),
        '@iOSXCUITFindBy(iOSClassChain = "**/XCUIElementTypeButton[`label == \'Go\'`]")\nprivate WebElement go;');
});

const steps = [
    { action: 'sendKeys', field: 'email', text: 'ada@example.com' },
    { action: 'click', field: 'signInButton' },
    { action: 'swipe', from: { x: 540, y: 1800 }, to: { x: 540, y: 600 } },
    { action: 'tapAt', x: 100.4, y: 200.6 },
    { action: 'back' },
];
const fields = [{ name: 'email', loc: email }, { name: 'signInButton', loc: id }];

test('java-client 11 page class: PageFactory from io.appium.java_client.support', () => {
    assert.strictEqual(C.pageClass(fields, steps, { platform: 'android', javaClient: '11', style: 'pageFactory', screen: { width: 1080, height: 2400 } }), `import io.appium.java_client.AppiumDriver;
import io.appium.java_client.pagefactory.AndroidFindBy;
import io.appium.java_client.pagefactory.AppiumFieldDecorator;
import io.appium.java_client.support.PageFactory;
import java.util.Map;
import org.openqa.selenium.WebElement;

public class RecordedPage {
    private final AppiumDriver driver;

    @AndroidFindBy(id = "com.example.shop:id/email")
    private WebElement email;

    @AndroidFindBy(id = "com.example.shop:id/sign_in")
    private WebElement signInButton;

    public RecordedPage(AppiumDriver driver) {
        this.driver = driver;
        PageFactory.initElements(new AppiumFieldDecorator(driver), this);
    }

    public void recordedFlow() {
        email.sendKeys("ada@example.com");
        signInButton.click();
        // coordinates from a 1080x2400 screen
        driver.executeScript("mobile: dragGesture", Map.of("startX", 540, "startY", 1800, "endX", 540, "endY", 600));
        // coordinates from a 1080x2400 screen
        driver.executeScript("mobile: clickGesture", Map.of("x", 100, "y", 201));
        driver.navigate().back();
    }
}
`);
});

test('java-client 9/10: PageFactory from org.openqa.selenium.support; iOS gestures in seconds', () => {
    const code = C.pageClass([{ name: 'loginButton', loc: { using: 'accessibility id', value: 'loginButton' } }],
        [{ action: 'click', field: 'loginButton' }, { action: 'longPressAt', x: 10, y: 20 }, { action: 'swipe', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } }, { action: 'home' }],
        { platform: 'ios', javaClient: '9-10', style: 'pageFactory' });
    assert.match(code, /^import org\.openqa\.selenium\.support\.PageFactory;$/m);
    assert.doesNotMatch(code, /io\.appium\.java_client\.support/);
    assert.match(code, /import io\.appium\.java_client\.pagefactory\.iOSXCUITFindBy;/);
    assert.match(code, /@iOSXCUITFindBy\(accessibility = "loginButton"\)/);
    assert.match(code, /mobile: touchAndHold", Map\.of\("x", 10, "y", 20, "duration", 0\.8\)/);
    assert.match(code, /mobile: dragFromToForDuration", Map\.of\("fromX", 1, "fromY", 2, "toX", 3, "toY", 4, "duration", 0\.3\)/);
    assert.match(code, /mobile: pressButton", Map\.of\("name", "home"\)/);
});

test('AppiumBy style: By constants, findElement calls, no PageFactory', () => {
    const code = C.pageClass([{ name: 'email', loc: email }, { name: 'list', loc: { using: 'xpath', value: '//x' } }],
        [{ action: 'sendKeys', field: 'email', text: 'a' }, { action: 'clear', field: 'list' }], { platform: 'android', javaClient: '11', style: 'appiumBy' });
    assert.match(code, /private static final By EMAIL = AppiumBy\.id\("com\.example\.shop:id\/email"\);/);
    assert.match(code, /private static final By LIST = By\.xpath\("\/\/x"\);/);
    assert.match(code, /driver\.findElement\(EMAIL\)\.sendKeys\("a"\);/);
    assert.match(code, /driver\.findElement\(LIST\)\.clear\(\);/);
    assert.doesNotMatch(code, /PageFactory|AppiumFieldDecorator|WebElement|java\.util\.Map/);
    assert.match(code, /^import io\.appium\.java_client\.AppiumBy;$/m);
    assert.match(code, /^import org\.openqa\.selenium\.By;$/m);
});
