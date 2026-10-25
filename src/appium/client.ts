/** The W3C element reference key (WebDriver spec, "web element identifier"). */
export const ELEMENT_KEY = 'element-6066-11e4-a52e-4f735466cecf';

export interface ServerStatus {
    ready: boolean;
    message: string;
    /** Appium version from `/status` (`value.build.version`); empty when the server does not report one. */
    version: string;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export interface NewSession {
    sessionId: string;
    capabilities: Record<string, unknown>;
}

/**
 * A failed Appium request. `unreachable`: no connection to the server at all. `timedOut`: the server took longer than
 * the command's timeout. Otherwise the server answered with a W3C error (`error`, `message`, `stacktrace`).
 */
export class AppiumError extends Error {
    constructor(
        message: string,
        readonly error = '',
        readonly httpStatus = 0,
        readonly stacktrace = '',
        readonly unreachable = false,
        readonly timedOut = false,
    ) {
        super(message);
    }

    get invalidSession(): boolean {
        return this.error === 'invalid session id';
    }
}

export const TIMEOUTS = {
    status: 3_000,
    newSession: 300_000, // the first WebDriverAgent build on iOS takes minutes
    deleteSession: 30_000,
    source: 120_000,
    screenshot: 30_000,
    quick: 10_000,
    command: 30_000,
};

/** A thin W3C WebDriver client for an Appium 3 server, on the global fetch. */
export class AppiumClient {
    readonly baseUrl: string;

    constructor(serverUrl: string) {
        this.baseUrl = serverUrl.replace(/\/+$/, '');
    }

    async request<T = unknown>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown, timeoutMs = TIMEOUTS.command): Promise<T> {
        let response: Response;
        try {
            response = await fetch(this.baseUrl + path, {
                method,
                headers: body === undefined ? undefined : { 'Content-Type': 'application/json; charset=utf-8' },
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
            });
        } catch (e) {
            const err = e as Error;
            if (err.name === 'TimeoutError' || err.name === 'AbortError') {
                throw new AppiumError(`Appium ${method} ${path} did not answer within ${Math.round(timeoutMs / 1000)} s`, '', 0, '', false, true);
            }
            const cause = (err as { cause?: { code?: string; message?: string } }).cause;
            throw new AppiumError(`Appium server at ${this.baseUrl} is not reachable (${cause?.code ?? cause?.message ?? err.message})`, '', 0, '', true);
        }
        const text = await response.text();
        let json: any;
        try {
            json = text ? JSON.parse(text) : {};
        } catch {
            throw new AppiumError(`Appium ${method} ${path}: HTTP ${response.status} without a JSON body`, '', response.status);
        }
        const value = json?.value;
        if (!response.ok || (value && typeof value === 'object' && typeof value.error === 'string')) {
            const error = typeof value?.error === 'string' ? value.error : 'unknown error';
            const message = typeof value?.message === 'string' && value.message ? value.message : `HTTP ${response.status}`;
            throw new AppiumError(message, error, response.status, typeof value?.stacktrace === 'string' ? value.stacktrace : '');
        }
        return value as T;
    }

    async status(timeoutMs = TIMEOUTS.status): Promise<ServerStatus> {
        const value = await this.request<any>('GET', '/status', undefined, timeoutMs);
        return {
            ready: value?.ready !== false,
            message: typeof value?.message === 'string' ? value.message : '',
            version: typeof value?.build?.version === 'string' ? value.build.version : '',
        };
    }

    async createSession(capabilities: Record<string, unknown>, timeoutMs = TIMEOUTS.newSession): Promise<NewSession> {
        const value = await this.request<any>('POST', '/session', { capabilities: { alwaysMatch: capabilities, firstMatch: [{}] } }, timeoutMs);
        if (!value?.sessionId) {
            throw new AppiumError('Appium created a session without a session id');
        }
        return { sessionId: value.sessionId, capabilities: value.capabilities ?? {} };
    }

    async deleteSession(sessionId: string): Promise<void> {
        await this.request('DELETE', session(sessionId), undefined, TIMEOUTS.deleteSession);
    }

    /** The page source as Appium returns it (XML for native contexts). */
    source(sessionId: string): Promise<string> {
        return this.request<string>('GET', session(sessionId, '/source'), undefined, TIMEOUTS.source);
    }

    /** The screenshot as a PNG data URL. */
    async screenshot(sessionId: string): Promise<string> {
        const base64 = await this.request<string>('GET', session(sessionId, '/screenshot'), undefined, TIMEOUTS.screenshot);
        return 'data:image/png;base64,' + base64;
    }

    /** Window size in the unit the driver uses for coordinates: pixels on Android, points on iOS. */
    windowRect(sessionId: string): Promise<Rect> {
        return this.request<Rect>('GET', session(sessionId, '/window/rect'), undefined, TIMEOUTS.quick);
    }

    async performActions(sessionId: string, actions: unknown[]): Promise<void> {
        await this.request('POST', session(sessionId, '/actions'), { actions });
    }

    async releaseActions(sessionId: string): Promise<void> {
        await this.request('DELETE', session(sessionId, '/actions'), undefined, TIMEOUTS.quick);
    }

    /** `mobile:` extensions and other scripts: `execute/sync` with one argument object. */
    executeScript<T = unknown>(sessionId: string, script: string, args: Record<string, unknown> = {}): Promise<T> {
        return this.request<T>('POST', session(sessionId, '/execute/sync'), { script, args: [args] });
    }

    async back(sessionId: string): Promise<void> {
        await this.request('POST', session(sessionId, '/back'), {}, TIMEOUTS.quick);
    }

    /** Element ids matching the locator; no match is an empty list, not an error. */
    async findElements(sessionId: string, using: string, value: string): Promise<string[]> {
        try {
            const list = await this.request<any[]>('POST', session(sessionId, '/elements'), { using, value });
            return (Array.isArray(list) ? list : []).map(e => e?.[ELEMENT_KEY] ?? e?.ELEMENT).filter((id): id is string => typeof id === 'string');
        } catch (e) {
            if (e instanceof AppiumError && e.error === 'no such element') {
                return [];
            }
            throw e;
        }
    }

    async setValue(sessionId: string, elementId: string, text: string): Promise<void> {
        await this.request('POST', session(sessionId, `/element/${encodeURIComponent(elementId)}/value`), { text });
    }

    getSettings(sessionId: string): Promise<Record<string, unknown>> {
        return this.request('GET', session(sessionId, '/appium/settings'), undefined, TIMEOUTS.quick);
    }

    async updateSettings(sessionId: string, settings: Record<string, unknown>): Promise<void> {
        await this.request('POST', session(sessionId, '/appium/settings'), { settings }, TIMEOUTS.quick);
    }

    /** Names of the `mobile:` extensions the session's driver offers (`/appium/extensions`, Appium 3). */
    async extensionNames(sessionId: string): Promise<Set<string>> {
        // { rest: { driver: { 'mobile: tap': {...} }, plugins: { <plugin>: { 'mobile: x': {...} } } } }
        const value = await this.request<any>('GET', session(sessionId, '/appium/extensions'), undefined, TIMEOUTS.quick);
        const maps: unknown[] = [value?.rest?.driver, ...Object.values(value?.rest?.plugins ?? {})];
        return new Set(maps.flatMap(m => (m && typeof m === 'object' ? Object.keys(m) : [])));
    }
}

function session(sessionId: string, path = ''): string {
    return `/session/${encodeURIComponent(sessionId)}${path}`;
}

/** The server URL for a host, port and base path, as Appium's `--address`, `--port` and `--base-path` build it. */
export function serverUrl(host: string, port: number, basePath = '/'): string {
    const h = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const base = ('/' + basePath.replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');
    return `http://${h}:${port}${base}`;
}
