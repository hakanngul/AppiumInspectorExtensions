// Appium locators for a page source tree: suggestions with match counts, hit testing and a local finder.
// Runs in the webview (window.AppiumLocators, nodes from DOMParser) and in Node tests (require, nodes from test/xml.js).
// A node only needs nodeName, getAttribute(name), children and parentNode.
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.AppiumLocators = api;
})(this, function () {
    'use strict';

    /** W3C `using` values, as Appium 3 and the java-client name them. */
    const USING = {
        id: 'id',
        accessibility: 'accessibility id',
        uiautomator: '-android uiautomator',
        predicate: '-ios predicate string',
        classChain: '-ios class chain',
        className: 'class name',
        xpath: 'xpath',
    };
    const LABEL = {
        id: 'id', accessibility: 'accessibility id', uiautomator: 'UiAutomator', predicate: 'predicate',
        classChain: 'class chain', className: 'class name', xpath: 'xpath',
    };

    // ── tree access ─────────────────────────────────────────────────────
    function attr(n, name) {
        const v = n && n.getAttribute ? n.getAttribute(name) : null;
        return v == null ? '' : String(v);
    }

    function kids(n) {
        return n && n.children ? Array.from(n.children) : [];
    }

    function platformOf(rootEl) {
        return rootEl && rootEl.nodeName === 'hierarchy' ? 'android' : 'ios';
    }

    /** The nodes under the document root (`hierarchy` or `AppiumAUT`), in document order. */
    function flatten(rootEl) {
        const out = [];
        const walk = n => kids(n).forEach(c => { out.push(c); walk(c); });
        walk(rootEl);
        return out;
    }

    function typeOf(n, platform) {
        return (platform === 'android' ? attr(n, 'class') : attr(n, 'type')) || n.nodeName;
    }

    function rectOf(n, platform) {
        if (platform === 'android') {
            const m = /^\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]$/.exec(attr(n, 'bounds'));
            return m ? { x: +m[1], y: +m[2], width: m[3] - m[1], height: m[4] - m[2] } : null;
        }
        const x = parseFloat(attr(n, 'x')), y = parseFloat(attr(n, 'y'));
        const width = parseFloat(attr(n, 'width')), height = parseFloat(attr(n, 'height'));
        return [x, y, width, height].every(Number.isFinite) ? { x, y, width, height } : null;
    }

    function isVisible(n, platform) {
        return platform === 'android' ? attr(n, 'displayed') !== 'false' : attr(n, 'visible') !== 'false';
    }

    /** The text a person sees for the node, for the tree and for field names. */
    function titleOf(n, platform) {
        if (platform === 'android') return attr(n, 'text') || attr(n, 'content-desc') || attr(n, 'hint');
        return attr(n, 'label') || attr(n, 'name') || attr(n, 'value') || attr(n, 'placeholderValue');
    }

    function shortType(type) {
        const t = String(type || '');
        return t.replace(/^XCUIElementType/, '').replace(/^.*\./, '');
    }

    /** The smallest visible node under the point; a later (deeper) node wins a tie. */
    function hitTest(nodes, platform, x, y) {
        let best = null, area = Infinity;
        for (const n of nodes) {
            if (!isVisible(n, platform)) continue;
            const r = rectOf(n, platform);
            if (!r || r.width <= 0 || r.height <= 0) continue;
            if (x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height) {
                const a = r.width * r.height;
                if (a <= area) { best = n; area = a; }
            }
        }
        return best;
    }

    // ── quoting ─────────────────────────────────────────────────────────
    /** An XPath 1.0 string literal; concat() when the value has both quote kinds. */
    function xpathLiteral(s) {
        s = String(s);
        if (!s.includes("'")) return "'" + s + "'";
        if (!s.includes('"')) return '"' + s + '"';
        return 'concat(' + s.split("'").map(p => "'" + p + "'").join(", \"'\", ") + ')';
    }

    /** A string for NSPredicate (single quotes, as Appium's examples use them). */
    function predicateLiteral(s) {
        return "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    }

    /** A Java string literal inside a UiSelector expression. */
    function uiSelectorLiteral(s) {
        return '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
    }

    // ── matching (what each strategy finds on this tree) ────────────────
    /** Android `id`: the full resource id, or the part after ":id/" (Appium adds the app package). */
    function idMatches(n, value) {
        const rid = attr(n, 'resource-id');
        return !!rid && (rid === value || rid.endsWith(':id/' + value));
    }

    function accessibilityOf(n, platform) {
        return platform === 'android' ? attr(n, 'content-desc') : attr(n, 'name');
    }

    const UI_METHODS = {
        resourceId: (n, v) => attr(n, 'resource-id') === v,
        resourceIdMatches: (n, v) => safeRegex(v, attr(n, 'resource-id')),
        description: (n, v) => attr(n, 'content-desc') === v,
        descriptionContains: (n, v) => attr(n, 'content-desc').includes(v),
        descriptionStartsWith: (n, v) => attr(n, 'content-desc').startsWith(v),
        text: (n, v) => attr(n, 'text') === v,
        textContains: (n, v) => attr(n, 'text').includes(v),
        textStartsWith: (n, v) => attr(n, 'text').startsWith(v),
        className: (n, v) => attr(n, 'class') === v,
        clickable: (n, v) => attr(n, 'clickable') === String(v),
        enabled: (n, v) => attr(n, 'enabled') === String(v),
        checked: (n, v) => attr(n, 'checked') === String(v),
        selected: (n, v) => attr(n, 'selected') === String(v),
        scrollable: (n, v) => attr(n, 'scrollable') === String(v),
    };

    function safeRegex(pattern, text) {
        try {
            return new RegExp('^(?:' + pattern + ')$').test(text);
        } catch (e) {
            return false;
        }
    }

    /** `new UiSelector().a("x").b(true).instance(2)`, the forms this file suggests and their common relatives. */
    function parseUiSelector(value) {
        const s = String(value).trim().replace(/;$/, '');
        const head = /^new\s+UiSelector\(\)/.exec(s);
        if (!head) return null;
        const calls = [];
        const re = /\.\s*(\w+)\(\s*("(?:[^"\\]|\\.)*"|true|false|\d+)\s*\)/y;
        re.lastIndex = head[0].length;
        let m;
        while (re.lastIndex < s.length && (m = re.exec(s))) {
            const raw = m[2];
            const arg = raw.startsWith('"') ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw === 'true' ? true : raw === 'false' ? false : Number(raw);
            calls.push({ name: m[1], arg });
        }
        if (re.lastIndex !== s.length && s.length !== head[0].length) return null;
        for (const c of calls) {
            if (c.name !== 'instance' && c.name !== 'index' && !UI_METHODS[c.name]) return null;
            if (c.name === 'index') return null; // index() is the position among siblings; not worth guessing
        }
        return calls;
    }

    function matchUiSelector(calls, nodes) {
        let out = nodes.filter(n => calls.every(c => c.name === 'instance' || UI_METHODS[c.name](n, c.arg)));
        const instance = calls.find(c => c.name === 'instance');
        if (instance) out = out[instance.arg] ? [out[instance.arg]] : [];
        return out;
    }

    /** `name == 'x' AND type == 'XCUIElementTypeButton'` and CONTAINS / BEGINSWITH / ENDSWITH; null when more complex. */
    function parsePredicate(value) {
        const parts = String(value).split(/\s+AND\s+/i);
        const conds = [];
        for (const p of parts) {
            const m = /^\s*(name|label|value|type|placeholderValue|enabled|visible|accessible)\s*(==|=|CONTAINS|BEGINSWITH|ENDSWITH)(\[c\])?\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|true|false|0|1)\s*$/i.exec(p);
            if (!m) return null;
            const raw = m[4];
            const v = /^['"]/.test(raw) ? raw.slice(1, -1).replace(/\\(.)/g, '$1') : raw === '1' ? 'true' : raw === '0' ? 'false' : raw.toLowerCase();
            conds.push({ attr: m[1], op: m[2].toUpperCase().replace(/^=$/, '=='), ci: !!m[3], value: v });
        }
        return conds;
    }

    function matchPredicate(conds, n) {
        return conds.every(c => {
            let a = attr(n, c.attr), v = c.value;
            if (c.ci) { a = a.toLowerCase(); v = v.toLowerCase(); }
            switch (c.op) {
                case '==': return a === v;
                case 'CONTAINS': return a.includes(v);
                case 'BEGINSWITH': return a.startsWith(v);
                case 'ENDSWITH': return a.endsWith(v);
            }
            return false;
        });
    }

    /** `**\/XCUIElementTypeButton`, optionally with one `[\`predicate\`]` and one `[n]`; null when more complex. */
    function parseClassChain(value) {
        const m = /^\*\*\/(XCUIElementType\w+|\*)(?:\[`((?:[^`])*)`\])?(?:\[(-?\d+)\])?$/.exec(String(value).trim());
        if (!m) return null;
        const conds = m[2] !== undefined ? parsePredicate(m[2]) : [];
        if (!conds) return null;
        return { type: m[1], conds, index: m[3] !== undefined ? Number(m[3]) : null };
    }

    function matchClassChain(chain, nodes) {
        let out = nodes.filter(n => (chain.type === '*' || attr(n, 'type') === chain.type) && matchPredicate(chain.conds, n));
        if (chain.index !== null) {
            const i = chain.index > 0 ? chain.index - 1 : out.length + chain.index;
            out = out[i] ? [out[i]] : [];
        }
        return out;
    }

    /**
     * Nodes a locator finds on this tree. ctx: { platform, nodes, evalXpath(expr) -> nodes }. Returns
     * { matches } or { unknown: true } when only the server can tell, or { error }.
     */
    function findLocal(using, value, ctx) {
        const { platform, nodes } = ctx;
        value = String(value);
        if (!value) return { matches: [] };
        switch (using) {
            case 'id':
                return { matches: nodes.filter(n => (platform === 'android' ? idMatches(n, value) : attr(n, 'name') === value)) };
            case 'accessibility id':
                return { matches: nodes.filter(n => accessibilityOf(n, platform) === value) };
            case 'class name':
                return { matches: nodes.filter(n => typeOf(n, platform) === value) };
            case 'xpath':
                if (!ctx.evalXpath) return { unknown: true };
                try {
                    return { matches: ctx.evalXpath(value) };
                } catch (e) {
                    return { error: 'Invalid XPath' };
                }
            case '-android uiautomator': {
                if (platform !== 'android') return { error: 'UiAutomator works on Android only' };
                const calls = parseUiSelector(value);
                return calls ? { matches: matchUiSelector(calls, nodes) } : { unknown: true };
            }
            case '-ios predicate string': {
                if (platform !== 'ios') return { error: 'Predicates work on iOS only' };
                const conds = parsePredicate(value);
                return conds ? { matches: nodes.filter(n => matchPredicate(conds, n)) } : { unknown: true };
            }
            case '-ios class chain': {
                if (platform !== 'ios') return { error: 'Class chains work on iOS only' };
                const chain = parseClassChain(value);
                return chain ? { matches: matchClassChain(chain, nodes) } : { unknown: true };
            }
        }
        return { unknown: true };
    }

    // ── suggestions ─────────────────────────────────────────────────────
    function equalsCount(nodes, test) {
        let c = 0;
        for (const n of nodes) if (test(n)) c++;
        return c;
    }

    /** `//tag[@a='x'][@b='y']`, its exact count, and the node's position among the matches. */
    function attrXpath(n, pairs, nodes) {
        const tag = n.nodeName;
        const test = m => m.nodeName === tag && pairs.every(([a, v]) => attr(m, a) === v);
        const matches = nodes.filter(test);
        return { expr: '//' + tag + pairs.map(([a, v]) => '[@' + a + '=' + xpathLiteral(v) + ']').join(''), count: matches.length, position: matches.indexOf(n) + 1 };
    }

    /** `/hierarchy/a[1]/b[2]`: unique by construction. */
    function absoluteXpath(n) {
        const parts = [];
        for (let cur = n; cur; cur = cur.parentNode) {
            const p = cur.parentNode;
            if (!p || p.nodeName === '#document') {
                parts.unshift(cur.nodeName);
                break;
            }
            const same = kids(p).filter(s => s.nodeName === cur.nodeName);
            parts.unshift(cur.nodeName + (same.length > 1 ? '[' + (same.indexOf(cur) + 1) + ']' : ''));
        }
        return '/' + parts.join('/');
    }

    function bestXpath(n, platform, nodes) {
        const keys = platform === 'android' ? ['resource-id', 'content-desc', 'text'] : ['name', 'label', 'value'];
        const present = keys.filter(k => attr(n, k)).map(k => [k, attr(n, k)]);
        let first = null;
        for (const p of present) {
            const x = attrXpath(n, [p], nodes);
            if (x.count === 1) return { value: x.expr, count: 1 };
            first = first || x;
        }
        for (let i = 0; i < present.length; i++) {
            for (let j = i + 1; j < present.length; j++) {
                const x = attrXpath(n, [present[i], present[j]], nodes);
                if (x.count === 1) return { value: x.expr, count: 1 };
            }
        }
        if (first && first.count <= 20) return { value: '(' + first.expr + ')[' + first.position + ']', count: 1 };
        return { value: absoluteXpath(n), count: 1 };
    }

    /**
     * Locator suggestions for a node, in the order of Appium's own advice: id and accessibility id first, XPath last.
     * Every count is exact on this tree; unique ones come first.
     */
    function suggest(n, ctx) {
        const { platform, nodes } = ctx;
        const out = [];
        const add = (kind, value, count) => out.push({ kind, label: LABEL[kind], using: USING[kind], value, count });
        const type = typeOf(n, platform);
        if (platform === 'android') {
            const rid = attr(n, 'resource-id'), desc = attr(n, 'content-desc'), text = attr(n, 'text');
            if (rid) add('id', rid, equalsCount(nodes, m => attr(m, 'resource-id') === rid));
            if (desc) add('accessibility', desc, equalsCount(nodes, m => attr(m, 'content-desc') === desc));
            const ui = [];
            if (rid) ui.push(['resourceId', rid]);
            if (desc) ui.push(['description', desc]);
            if (text) ui.push(['text', text]);
            let uiDone = false;
            for (const [method, v] of ui) {
                const calls = [{ name: method, arg: v }];
                const c = matchUiSelector(calls, nodes).length;
                if (c === 1) {
                    add('uiautomator', 'new UiSelector().' + method + '(' + uiSelectorLiteral(v) + ')', 1);
                    uiDone = true;
                    break;
                }
            }
            if (!uiDone && ui.length) {
                const [method, v] = ui[0];
                const calls = [{ name: 'className', arg: type }, { name: method, arg: v }];
                const matches = matchUiSelector(calls, nodes);
                const base = 'new UiSelector().className(' + uiSelectorLiteral(type) + ').' + method + '(' + uiSelectorLiteral(v) + ')';
                if (matches.length === 1) add('uiautomator', base, 1);
                else if (matches.length > 1) add('uiautomator', base + '.instance(' + matches.indexOf(n) + ')', 1);
            }
        } else {
            const name = attr(n, 'name'), label = attr(n, 'label'), value = attr(n, 'value');
            if (name) add('accessibility', name, equalsCount(nodes, m => attr(m, 'name') === name));
            const preds = [];
            if (label) preds.push(['label', label]);
            if (name && name !== label) preds.push(['name', name]);
            if (value && value !== label) preds.push(['value', value]);
            if (preds.length) {
                const [a, v] = preds[0];
                const plain = nodes.filter(m => attr(m, a) === v);
                if (plain.length === 1) {
                    add('predicate', a + ' == ' + predicateLiteral(v), 1);
                } else {
                    const typed = plain.filter(m => attr(m, 'type') === type);
                    add('predicate', 'type == ' + predicateLiteral(type) + ' AND ' + a + ' == ' + predicateLiteral(v), typed.length);
                }
                if (!String(v).includes('`')) {
                    const chainMatches = nodes.filter(m => attr(m, 'type') === type && attr(m, a) === v);
                    const chain = '**/' + type + '[`' + a + ' == ' + predicateLiteral(v) + '`]';
                    if (chainMatches.length <= 1) add('classChain', chain, chainMatches.length);
                    else add('classChain', chain + '[' + (chainMatches.indexOf(n) + 1) + ']', 1);
                }
            }
        }
        const sameType = equalsCount(nodes, m => typeOf(m, platform) === type);
        if (sameType === 1) add('className', type, 1);
        const x = bestXpath(n, platform, nodes);
        add('xpath', x.value, x.count);
        // unique first, then the order above
        return out.map((s, i) => ({ s, i })).sort((a, b) => (a.s.count === 1 ? 0 : 1) - (b.s.count === 1 ? 0 : 1) || a.i - b.i).map(x => x.s);
    }

    /** Words for a Java field name: the id's last part, the accessibility id, the text, then the type. */
    function nameSeed(n, platform) {
        const rid = attr(n, 'resource-id').replace(/^.*:id\//, '');
        const parts = platform === 'android' ? [rid, attr(n, 'content-desc'), attr(n, 'text')] : [attr(n, 'name'), attr(n, 'label'), attr(n, 'value')];
        const words = parts.find(p => p && p.length <= 40 && /[A-Za-z]/.test(p));
        return { words: words || '', type: shortType(typeOf(n, platform)) };
    }

    return {
        USING, LABEL, attr, kids, platformOf, flatten, typeOf, rectOf, isVisible, titleOf, shortType, hitTest,
        xpathLiteral, predicateLiteral, uiSelectorLiteral, parseUiSelector, parsePredicate, parseClassChain,
        findLocal, suggest, absoluteXpath, nameSeed,
    };
});
