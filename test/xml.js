// A small XML reader for tests: elements with nodeName, attributes, getAttribute, children and parentNode, the
// subset of the DOM that media/locators.js uses. Not a general parser: no CDATA, no DTD, no namespaces.
const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decode(s) {
    return s.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (m, e) => (e[0] === '#'
        ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
        : ENTITIES[e] ?? m));
}

function parse(xml) {
    const doc = { nodeName: '#document', children: [], parentNode: null };
    const stack = [doc];
    const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<\/([\w.:$-]+)\s*>|<([\w.:$-]+)((?:\s+[\w.:-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>/g;
    let m;
    while ((m = re.exec(xml))) {
        if (m[1]) {
            stack.pop();
        } else if (m[2]) {
            const parent = stack[stack.length - 1];
            const attrs = {};
            const list = [];
            for (const a of m[3].matchAll(/([\w.:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
                const value = decode(a[2] ?? a[3]);
                attrs[a[1]] = value;
                list.push({ name: a[1], value });
            }
            const node = {
                nodeName: m[2], children: [], parentNode: parent, attributes: list,
                getAttribute: name => (name in attrs ? attrs[name] : null),
            };
            parent.children.push(node);
            if (!m[4]) stack.push(node);
        }
    }
    return { document: doc, root: doc.children[0] };
}

module.exports = { parse };
