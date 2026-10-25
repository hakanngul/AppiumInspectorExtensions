/**
 * Removes what XML 1.0 forbids from an Appium page source, so that the webview's DOMParser can read it: raw control
 * characters and lone surrogates, and character references to them (`&#1;`, `&#x1F;`), which app texts sometimes carry.
 */
export function sanitizeXml(xml: string): string {
    return xml
        .replace(/[^\x09\x0A\x0D\x20-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, '')
        .replace(/&#(x[0-9a-fA-F]+|[0-9]+);/g, (ref, code: string) => (allowedCodePoint(code.startsWith('x') ? parseInt(code.slice(1), 16) : parseInt(code, 10)) ? ref : ''));
}

function allowedCodePoint(cp: number): boolean {
    return cp === 0x9 || cp === 0xA || cp === 0xD || (cp >= 0x20 && cp <= 0xD7FF) || (cp >= 0xE000 && cp <= 0xFFFD) || (cp >= 0x10000 && cp <= 0x10FFFF);
}
