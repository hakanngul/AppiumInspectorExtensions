const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../media/locators.js');
const { parse } = require('./xml.js');

function load(name) {
    const { root } = parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));
    const platform = L.platformOf(root);
    const nodes = L.flatten(root);
    return { root, platform, nodes, ctx: { platform, nodes } };
}

const byAttr = (nodes, name, value) => nodes.filter(n => n.getAttribute(name) === value);

test('tree basics: platform, flattening, types, rects, titles', () => {
    const a = load('android-source.xml');
    assert.strictEqual(a.platform, 'android');
    assert.strictEqual(a.nodes.length, 11);
    const button = byAttr(a.nodes, 'resource-id', 'com.example.shop:id/sign_in')[0];
    assert.strictEqual(L.typeOf(button, 'android'), 'android.widget.Button');
    assert.deepStrictEqual(L.rectOf(button, 'android'), { x: 64, y: 720, width: 952, height: 132 });
    assert.strictEqual(L.titleOf(button, 'android'), 'Sign in');
    assert.strictEqual(L.titleOf(byAttr(a.nodes, 'resource-id', 'com.example.shop:id/email')[0], 'android'), 'E-mail', 'hint when there is no text');

    const i = load('ios-source.xml');
    assert.strictEqual(i.platform, 'ios');
    const login = byAttr(i.nodes, 'name', 'loginButton')[0];
    assert.deepStrictEqual(L.rectOf(login, 'ios'), { x: 24, y: 310, width: 354, height: 50 });
    assert.strictEqual(L.titleOf(login, 'ios'), 'Sign in');
    assert.strictEqual(L.shortType('XCUIElementTypeSecureTextField'), 'SecureTextField');
    assert.strictEqual(L.shortType('androidx.recyclerview.widget.RecyclerView'), 'RecyclerView');
});

test('hitTest picks the smallest visible element under the point', () => {
    const a = load('android-source.xml');
    assert.strictEqual(L.hitTest(a.nodes, 'android', 500, 780).getAttribute('resource-id'), 'com.example.shop:id/sign_in');
    assert.strictEqual(L.hitTest(a.nodes, 'android', 1050, 1500).getAttribute('resource-id'), 'com.example.shop:id/offers');
    const i = load('ios-source.xml');
    assert.strictEqual(L.hitTest(i.nodes, 'ios', 100, 330).getAttribute('name'), 'loginButton');
    assert.strictEqual(L.hitTest(i.nodes, 'ios', 100, 650).getAttribute('type'), 'XCUIElementTypeOther', 'an invisible image is skipped');
});

test('Android suggestions: id first, every count exact, a unique XPath at the end', () => {
    const a = load('android-source.xml');
    const button = byAttr(a.nodes, 'resource-id', 'com.example.shop:id/sign_in')[0];
    assert.deepStrictEqual(L.suggest(button, a.ctx).map(s => [s.using, s.value, s.count]), [
        ['id', 'com.example.shop:id/sign_in', 1],
        ['accessibility id', 'Sign in', 1],
        ['-android uiautomator', 'new UiSelector().resourceId("com.example.shop:id/sign_in")', 1],
        ['class name', 'android.widget.Button', 1],
        ['xpath', "//android.widget.Button[@resource-id='com.example.shop:id/sign_in']", 1],
    ]);
});

test('Android duplicates: the id is not unique, UiSelector gets instance(), XPath gets a position', () => {
    const a = load('android-source.xml');
    const second = byAttr(a.nodes, 'resource-id', 'com.example.shop:id/add')[1];
    const list = L.suggest(second, a.ctx);
    assert.deepStrictEqual(list.find(s => s.using === 'id').count, 2);
    assert.deepStrictEqual(list.find(s => s.using === '-android uiautomator').value,
        'new UiSelector().className("android.widget.TextView").resourceId("com.example.shop:id/add").instance(1)');
    assert.strictEqual(list.find(s => s.using === 'xpath').value, "(//android.widget.TextView[@resource-id='com.example.shop:id/add'])[2]");
    assert.strictEqual(list[0].count, 1, 'unique suggestions first');
    assert.strictEqual(list[list.length - 1].using, 'id', 'the ambiguous id goes last');
    // and the local finder agrees with each suggestion
    for (const s of list.filter(s => s.count === 1 && s.using !== 'xpath')) {
        assert.deepStrictEqual(L.findLocal(s.using, s.value, a.ctx).matches, [second], s.using);
    }
});

test('an element with no id, text or description gets an absolute XPath', () => {
    const a = load('android-source.xml');
    const image = a.nodes.find(n => n.nodeName === 'android.widget.ImageView');
    const list = L.suggest(image, a.ctx);
    assert.deepStrictEqual(list.map(s => s.using), ['class name', 'xpath']);
    assert.strictEqual(list[1].value, '/hierarchy/android.widget.FrameLayout/android.widget.LinearLayout/androidx.recyclerview.widget.RecyclerView/android.widget.ImageView');
});

test('quotes: XPath concat() and escaped UiSelector strings', () => {
    const a = load('android-source.xml');
    const deal = a.nodes.find(n => n.getAttribute('text') === 'Tom\'s "best" deal');
    const list = L.suggest(deal, a.ctx);
    assert.strictEqual(list.find(s => s.using === '-android uiautomator').value, 'new UiSelector().text("Tom\'s \\"best\\" deal")');
    assert.strictEqual(list.find(s => s.using === 'xpath').value, `//android.widget.TextView[@text=concat('Tom', "'", 's "best" deal')]`);
    assert.strictEqual(L.xpathLiteral("it's"), '"it\'s"');
    assert.strictEqual(L.predicateLiteral("it's \\ ok"), "'it\\'s \\\\ ok'");
    assert.deepStrictEqual(L.findLocal('-android uiautomator', list.find(s => s.using === '-android uiautomator').value, a.ctx).matches, [deal]);
});

test('iOS suggestions: accessibility id, predicate, class chain, XPath', () => {
    const i = load('ios-source.xml');
    const login = byAttr(i.nodes, 'name', 'loginButton')[0];
    assert.deepStrictEqual(L.suggest(login, i.ctx).map(s => [s.using, s.value, s.count]), [
        ['accessibility id', 'loginButton', 1],
        ['-ios predicate string', "label == 'Sign in'", 1],
        ['-ios class chain', "**/XCUIElementTypeButton[`label == 'Sign in'`]", 1],
        ['xpath', "//XCUIElementTypeButton[@name='loginButton']", 1],
    ]);
    const second = byAttr(i.nodes, 'name', 'Add to cart')[1];
    const list = L.suggest(second, i.ctx);
    assert.strictEqual(list.find(s => s.using === '-ios class chain').value, "**/XCUIElementTypeButton[`label == 'Add to cart'`][2]");
    assert.strictEqual(list.find(s => s.using === 'accessibility id').count, 2);
    assert.deepStrictEqual(L.findLocal('-ios class chain', list.find(s => s.using === '-ios class chain').value, i.ctx).matches, [second]);
});

test('local finder: strategies, platform checks, and what only the device can answer', () => {
    const a = load('android-source.xml');
    assert.strictEqual(L.findLocal('id', 'sign_in', a.ctx).matches.length, 1, 'id without the package, as Appium accepts it');
    assert.strictEqual(L.findLocal('class name', 'android.widget.EditText', a.ctx).matches.length, 2);
    assert.strictEqual(L.findLocal('-android uiautomator', 'new UiSelector().textContains("cart")', a.ctx).matches.length, 2);
    assert.strictEqual(L.findLocal('-android uiautomator', 'new UiSelector().clickable(true).className("android.widget.EditText")', a.ctx).matches.length, 2);
    assert.ok(L.findLocal('-android uiautomator', 'new UiScrollable(new UiSelector().scrollable(true))', a.ctx).unknown);
    assert.match(L.findLocal('-ios predicate string', "label == 'x'", a.ctx).error, /iOS only/);
    assert.ok(L.findLocal('xpath', '//x', a.ctx).unknown, 'XPath needs the webview DOM');

    const i = load('ios-source.xml');
    assert.strictEqual(L.findLocal('-ios predicate string', "type == 'XCUIElementTypeButton' AND label BEGINSWITH 'Add'", i.ctx).matches.length, 2);
    assert.strictEqual(L.findLocal('-ios predicate string', "label ==[c] 'sign IN'", i.ctx).matches.length, 1);
    assert.ok(L.findLocal('-ios predicate string', "label MATCHES '.*'", i.ctx).unknown);
    assert.strictEqual(L.findLocal('-ios class chain', '**/XCUIElementTypeButton', i.ctx).matches.length, 3);
    assert.strictEqual(L.findLocal('-ios class chain', '**/XCUIElementTypeButton[-1]', i.ctx).matches[0].getAttribute('x'), '208');
    assert.strictEqual(L.findLocal('accessibility id', 'emailField', i.ctx).matches.length, 1);
    assert.match(L.findLocal('-android uiautomator', 'new UiSelector()', i.ctx).error, /Android only/);
});

test('field name seeds', () => {
    const a = load('android-source.xml');
    assert.deepStrictEqual(L.nameSeed(byAttr(a.nodes, 'resource-id', 'com.example.shop:id/sign_in')[0], 'android'), { words: 'sign_in', type: 'Button' });
    const i = load('ios-source.xml');
    assert.deepStrictEqual(L.nameSeed(byAttr(i.nodes, 'name', 'emailField')[0], 'ios'), { words: 'emailField', type: 'TextField' });
});
