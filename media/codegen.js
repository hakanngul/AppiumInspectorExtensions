// Java output for the Appium java-client: page factory fields (@AndroidFindBy / @iOSXCUITFindBy) or AppiumBy constants,
// and the page class Record mode builds. Runs in the webview (window.AppiumCodegen) and in Node tests (require).
//
// java-client 11 moved PageFactory into io.appium.java_client.support and no longer brings selenium-support; with
// 9.x/10.x PageFactory comes from org.openqa.selenium.support (checked against the 9.5.0, 10.1.1 and 11.0.0 jars).
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AppiumCodegen = api;
})(this, function () {
    'use strict';

    /** @AndroidFindBy / @iOSXCUITFindBy member for each W3C strategy. */
    const MEMBER = {
        'id': 'id',
        'accessibility id': 'accessibility',
        '-android uiautomator': 'uiAutomator',
        '-ios predicate string': 'iOSNsPredicate',
        '-ios class chain': 'iOSClassChain',
        'class name': 'className',
        'xpath': 'xpath',
    };
    /** By factory for each strategy; AppiumBy has no xpath(), Selenium's By has. */
    const BY = {
        'id': 'AppiumBy.id',
        'accessibility id': 'AppiumBy.accessibilityId',
        '-android uiautomator': 'AppiumBy.androidUIAutomator',
        '-ios predicate string': 'AppiumBy.iOSNsPredicateString',
        '-ios class chain': 'AppiumBy.iOSClassChain',
        'class name': 'AppiumBy.className',
        'xpath': 'By.xpath',
    };
    const KEYWORDS = new Set(('abstract assert boolean break byte case catch char class const continue default do double else enum extends final ' +
        'finally float for goto if implements import instanceof int interface long native new package private protected public return short ' +
        'static strictfp super switch synchronized this throw throws transient try void volatile while true false null var record yield sealed permits').split(' '));

    function javaString(s) {
        return '"' + String(s).replace(/[\\"\n\r\t]|[\u0000-\u001f\u007f\u2028\u2029]/g, c => {
            switch (c) {
                case '\\': return '\\\\';
                case '"': return '\\"';
                case '\n': return '\\n';
                case '\r': return '\\r';
                case '\t': return '\\t';
                default: return '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
            }
        }) + '"';
    }

    /** camelCase Java identifier from free text: "Sign in" + "Button" -> signInButton; unique within `used`. */
    function fieldName(seed, used) {
        const fromWords = text => String(text || '')
            // Letters NFKD leaves non-ASCII (Turkish dotless i and a few others) are mapped first.
            .replace(/[\u0131\u0130\u0142\u0141\u00F8\u00D8\u00E6\u00C6\u00DF\u0111\u0110]/g, c => ({ '\u0131': 'i', '\u0130': 'I', '\u0142': 'l', '\u0141': 'L', '\u00F8': 'o', '\u00D8': 'O', '\u00E6': 'ae', '\u00C6': 'Ae', '\u00DF': 'ss', '\u0111': 'd', '\u0110': 'D' }[c]))
            .normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .split(/[^A-Za-z0-9]+/).filter(Boolean).slice(0, 5)
            .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())).join('');
        const words = fromWords(seed && seed.words);
        const type = fromWords(seed && seed.type);
        let name = words ? words + (type && !words.toLowerCase().endsWith(type.toLowerCase()) ? type.charAt(0).toUpperCase() + type.slice(1) : '') : type || 'element';
        if (/^[0-9]/.test(name)) name = 'el' + name.charAt(0).toUpperCase() + name.slice(1);
        if (KEYWORDS.has(name)) name += 'Element';
        let unique = name;
        for (let i = 2; used && used.has(unique); i++) unique = name + i;
        if (used) used.add(unique);
        return unique;
    }

    function constName(name) {
        return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
    }

    function annotation(platform) {
        return platform === 'ios' ? 'iOSXCUITFindBy' : 'AndroidFindBy';
    }

    function annotationLine(loc, platform) {
        return '@' + annotation(platform) + '(' + MEMBER[loc.using] + ' = ' + javaString(loc.value) + ')';
    }

    function byExpression(loc) {
        return BY[loc.using] + '(' + javaString(loc.value) + ')';
    }

    /** One field: `@AndroidFindBy(id = "...")\nprivate WebElement name;` or `private static final By NAME = AppiumBy...;`. */
    function field(loc, o) {
        if (o.style === 'appiumBy') return 'private static final By ' + constName(o.name) + ' = ' + byExpression(loc) + ';';
        return annotationLine(loc, o.platform) + '\nprivate WebElement ' + o.name + ';';
    }

    function imports(o, uses) {
        const list = new Set(['io.appium.java_client.AppiumDriver']);
        if (o.style === 'appiumBy') {
            if (uses.appiumBy) list.add('io.appium.java_client.AppiumBy');
            list.add('org.openqa.selenium.By');
        } else {
            if (uses.fields) {
                list.add('io.appium.java_client.pagefactory.' + annotation(o.platform));
                list.add('org.openqa.selenium.WebElement');
            }
            list.add('io.appium.java_client.pagefactory.AppiumFieldDecorator');
            list.add(o.javaClient === '9-10' ? 'org.openqa.selenium.support.PageFactory' : 'io.appium.java_client.support.PageFactory');
        }
        if (uses.map) list.add('java.util.Map');
        return [...list].sort((a, b) => a.localeCompare(b)).map(i => 'import ' + i + ';').join('\n');
    }

    function mapOf(args) {
        const entries = Object.entries(args).map(([k, v]) => javaString(k) + ', ' + (typeof v === 'string' ? javaString(v) : String(v)));
        return 'Map.of(' + entries.join(', ') + ')';
    }

    function mobileCall(script, args) {
        return 'driver.executeScript(' + javaString(script) + ', ' + mapOf(args) + ');';
    }

    // Same commands as src/appium/gestures.ts: Android durations in milliseconds, iOS in seconds.
    function gestureLine(step, platform) {
        const r = Math.round;
        switch (step.action) {
            case 'tapAt':
                return platform === 'android' ? mobileCall('mobile: clickGesture', { x: r(step.x), y: r(step.y) }) : mobileCall('mobile: tap', { x: r(step.x), y: r(step.y) });
            case 'longPressAt':
                return platform === 'android' ? mobileCall('mobile: longClickGesture', { x: r(step.x), y: r(step.y), duration: 800 })
                    : mobileCall('mobile: touchAndHold', { x: r(step.x), y: r(step.y), duration: 0.8 });
            case 'swipe':
                return platform === 'android'
                    ? mobileCall('mobile: dragGesture', { startX: r(step.from.x), startY: r(step.from.y), endX: r(step.to.x), endY: r(step.to.y) })
                    : mobileCall('mobile: dragFromToForDuration', { fromX: r(step.from.x), fromY: r(step.from.y), toX: r(step.to.x), toY: r(step.to.y), duration: 0.3 });
            case 'home':
                return platform === 'android' ? mobileCall('mobile: pressKey', { keycode: 3 }) : mobileCall('mobile: pressButton', { name: 'home' });
            case 'back':
                return 'driver.navigate().back();';
        }
        return '';
    }

    /**
     * The page class for recorded steps. Steps: { action: 'click' | 'sendKeys' | 'clear', field } with fields
     * [{ name, loc }], or { action: 'tapAt' | 'longPressAt', x, y }, { action: 'swipe', from, to }, { action: 'back' | 'home' }.
     * o: { platform, javaClient: '11' | '9-10', style: 'pageFactory' | 'appiumBy', className }.
     */
    function pageClass(fields, steps, o) {
        const cls = o.className || 'RecordedPage';
        const byName = new Map(fields.map(f => [f.name, f]));
        const ref = name => (o.style === 'appiumBy' ? 'driver.findElement(' + constName(name) + ')' : name);
        const body = [];
        let map = false;
        for (const s of steps) {
            if (s.action === 'click' || s.action === 'sendKeys' || s.action === 'clear') {
                if (!byName.has(s.field)) continue;
                body.push(ref(s.field) + (s.action === 'click' ? '.click();' : s.action === 'clear' ? '.clear();' : '.sendKeys(' + javaString(s.text) + ');'));
            } else {
                const line = gestureLine(s, o.platform);
                if (!line) continue;
                if (s.action !== 'back') map = true;
                if (s.action === 'tapAt' || s.action === 'longPressAt' || s.action === 'swipe') {
                    body.push('// coordinates from a ' + (o.screen ? o.screen.width + 'x' + o.screen.height : 'recorded') + ' screen');
                }
                body.push(line);
            }
        }
        const uses = { fields: fields.length > 0, map, appiumBy: fields.some(f => BY[f.loc.using].startsWith('AppiumBy')) };
        const out = [];
        out.push(imports(o, uses), '', 'public class ' + cls + ' {', '    private final AppiumDriver driver;', '');
        for (const f of fields) {
            out.push(field(f.loc, { platform: o.platform, style: o.style, name: f.name }).split('\n').map(l => '    ' + l).join('\n'));
            if (o.style !== 'appiumBy') out.push('');
        }
        if (o.style === 'appiumBy' && fields.length) out.push('');
        out.push('    public ' + cls + '(AppiumDriver driver) {', '        this.driver = driver;');
        if (o.style !== 'appiumBy') out.push('        PageFactory.initElements(new AppiumFieldDecorator(driver), this);');
        out.push('    }', '', '    public void recordedFlow() {');
        for (const line of body) out.push('        ' + line);
        out.push('    }', '}', '');
        return out.join('\n');
    }

    return { MEMBER, BY, javaString, fieldName, constName, annotationLine, byExpression, field, pageClass };
});
