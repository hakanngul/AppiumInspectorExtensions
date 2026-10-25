import { ChildProcess } from 'child_process';
import { delay, killTree, killTreeNow, run, start, ToolNotFoundError, toolEnv } from '../process';
import { AppiumClient, AppiumError, serverUrl } from './client';

export interface ServerOptions {
    /** Appium executable: a name on PATH or a path. */
    appiumPath: string;
    host: string;
    port: number;
    basePath: string;
    allowCors: boolean;
    /** Extra environment for the server process. */
    env?: Record<string, string>;
}

/**
 * stopped: nothing answers. starting / stopping: this extension is changing that. running: the server this extension
 * started. external: a server started elsewhere answers on the address; it is used but never stopped from here.
 */
export type ServerState = 'stopped' | 'starting' | 'running' | 'external' | 'stopping';

export interface ServerInfo {
    state: ServerState;
    url: string;
    version: string;
    message: string;
}

export interface InstalledDriver {
    name: string;
    version: string;
    automationName: string;
    platforms: string[];
}

const INSTALL_HELP = 'Install Appium 3 with "npm install -g appium" (Node 20.19+, 22.12+ or 24+) or set testflyAppiumInspector.appium.path.';

/** Starts, watches and stops one local Appium server. */
export class AppiumServer {
    readonly client: AppiumClient;
    readonly url: string;
    private child?: ChildProcess;
    private info: ServerInfo;
    private tail: string[] = [];

    constructor(readonly options: ServerOptions, private readonly log: (line: string) => void = () => undefined,
        private readonly onChange: (info: ServerInfo) => void = () => undefined) {
        validateOptions(options);
        this.url = serverUrl(options.host, options.port, options.basePath);
        this.client = new AppiumClient(this.url);
        this.info = { state: 'stopped', url: this.url, version: '', message: '' };
    }

    get current(): ServerInfo {
        return this.info;
    }

    /** True while the server process this extension started is alive. */
    get owned(): boolean {
        return !!this.child && this.child.exitCode === null && this.child.signalCode === null;
    }

    private set(state: ServerState, version = this.info.version, message = '') {
        this.info = { state, url: this.url, version, message };
        this.onChange(this.info);
    }

    /** Asks `/status` and updates the state; does not start anything. */
    async check(): Promise<ServerInfo> {
        if (this.info.state === 'starting' || this.info.state === 'stopping') {
            return this.info;
        }
        try {
            const status = await this.client.status();
            this.set(this.owned ? 'running' : 'external', status.version, status.message);
        } catch (e) {
            if (!(e instanceof AppiumError) || e.httpStatus === 0) {
                this.set('stopped', '', '');
            } else {
                this.set('stopped', '', `Something that is not Appium answers at ${this.url}`);
            }
        }
        return this.info;
    }

    /** Uses a server that already answers; otherwise starts one and waits until `/status` is ready. */
    async start(timeoutMs = 30_000): Promise<ServerInfo> {
        const now = await this.check();
        if (now.state === 'running' || now.state === 'external' || now.state === 'starting') {
            return now;
        }
        if (now.message) {
            throw new Error(`${now.message}. Free port ${this.options.port} or set testflyAppiumInspector.appium.port.`);
        }
        this.set('starting', '', '');
        this.tail = [];
        const args = serverArgs(this.options);
        this.log(`$ ${this.options.appiumPath} ${args.join(' ')}`);
        let child: ChildProcess;
        try {
            child = await start(this.options.appiumPath, args, await toolEnv(this.options.env));
            for (const [k, v] of Object.entries(this.options.env ?? {})) {
                this.log(`  ${k}=${v}`);
            }
        } catch (e) {
            this.set('stopped');
            throw e instanceof ToolNotFoundError ? new Error(`Appium was not found (${this.options.appiumPath}). ${INSTALL_HELP}`) : e;
        }
        this.child = child;
        const exited = new Promise<number | null>(resolve => {
            child.once('error', err => {
                this.log(`Could not start Appium: ${err.message}`);
                resolve(-1);
            });
            child.once('exit', code => resolve(code));
        });
        child.once('exit', (code, signal) => {
            this.log(`Appium exited (${signal ?? `code ${code}`})`);
            if (this.child === child) {
                this.child = undefined;
                if (this.info.state !== 'stopping') {
                    this.set('stopped', '', this.info.state === 'running' ? 'The Appium server stopped by itself; see the log.' : '');
                }
            }
        });
        this.pipe(child);

        const deadline = Date.now() + timeoutMs;
        let exitCode: number | null | undefined;
        void exited.then(code => (exitCode = code));
        while (Date.now() < deadline) {
            if (exitCode !== undefined) {
                this.set('stopped');
                throw new Error(`Appium exited before it was ready${this.reason()}`);
            }
            try {
                const status = await this.client.status(1_000);
                if (status.ready) {
                    this.set('running', status.version, status.message);
                    return this.info;
                }
            } catch {
                // not listening yet
            }
            await Promise.race([delay(300), exited]);
        }
        await killTree(child);
        this.set('stopped');
        throw new Error(`Appium did not become ready at ${this.url} within ${Math.round(timeoutMs / 1000)} s${this.reason()}`);
    }

    /** Stops the server this extension started and waits until the address is free; a server started elsewhere is left alone. */
    async stop(): Promise<ServerInfo> {
        const child = this.child;
        if (!child || !this.owned) {
            return this.check();
        }
        this.set('stopping');
        await killTree(child);
        this.child = undefined;
        for (let i = 0; i < 20; i++) {
            try {
                await this.client.status(500);
            } catch (e) {
                if (e instanceof AppiumError && (e.unreachable || e.timedOut)) {
                    break;
                }
            }
            await delay(150);
        }
        this.set('stopped', '', '');
        return this.check();
    }

    /** For deactivate(): signals the owned server without waiting. */
    dispose() {
        if (this.child) {
            killTreeNow(this.child);
            this.child = undefined;
        }
    }

    /** `appium --version`; throws with install help when Appium is missing. */
    async version(): Promise<string> {
        try {
            const { stdout } = await run(this.options.appiumPath, ['--version'], 15_000);
            return stdout.trim().split(/\s+/).pop() ?? '';
        } catch (e) {
            throw e instanceof ToolNotFoundError ? new Error(`Appium was not found (${this.options.appiumPath}). ${INSTALL_HELP}`) : e;
        }
    }

    /** Installed drivers from `appium driver list --installed --json`. */
    async drivers(): Promise<InstalledDriver[]> {
        const { stdout } = await run(this.options.appiumPath, ['driver', 'list', '--installed', '--json'], 60_000);
        return parseDriverList(stdout);
    }

    private pipe(child: ChildProcess) {
        for (const stream of [child.stdout, child.stderr]) {
            let rest = '';
            stream?.setEncoding('utf8');
            stream?.on('data', (chunk: string) => {
                const lines = (rest + chunk).split(/\r?\n/);
                rest = lines.pop() ?? '';
                for (const line of lines) {
                    this.log(line);
                    this.tail.push(line);
                    if (this.tail.length > 20) {
                        this.tail.shift();
                    }
                }
            });
        }
    }

    private reason(): string {
        const text = this.tail.join('\n');
        if (/EADDRINUSE|address already in use/i.test(text)) {
            return `: port ${this.options.port} is already in use. Free it or set testflyAppiumInspector.appium.port.`;
        }
        const last = this.tail.filter(l => l.trim()).slice(-2).join(' ').trim();
        return last ? `: ${last}` : '. See the TestFly Appium output.';
    }
}

/** Command line for `appium server`; only flags that Appium 3.8 documents. */
export function serverArgs(o: ServerOptions): string[] {
    const args = ['server', '--address', o.host, '--port', String(o.port)];
    const base = '/' + o.basePath.replace(/^\/+|\/+$/g, '');
    if (base !== '/') {
        args.push('--base-path', base);
    }
    if (o.allowCors) {
        args.push('--allow-cors');
    }
    return args;
}

export function validateOptions(o: ServerOptions) {
    if (!/^[A-Za-z0-9.\-:[\]]+$/.test(o.host)) {
        throw new Error(`Invalid Appium host: ${o.host}`);
    }
    if (!Number.isInteger(o.port) || o.port < 1 || o.port > 65535) {
        throw new Error(`Invalid Appium port: ${o.port}`);
    }
    if (!/^\/?[A-Za-z0-9._\-/]*$/.test(o.basePath)) {
        throw new Error(`Invalid Appium base path: ${o.basePath}`);
    }
    if (!o.appiumPath.trim()) {
        throw new Error('testflyAppiumInspector.appium.path is empty');
    }
}

/**
 * Parses `appium driver list --installed --json`: an object keyed by driver name. Appium may print log lines around
 * the JSON, so the outermost object is cut out first.
 */
export function parseDriverList(stdout: string): InstalledDriver[] {
    const start = stdout.indexOf('{');
    const end = stdout.lastIndexOf('}');
    if (start < 0 || end < start) {
        return [];
    }
    const json = JSON.parse(stdout.slice(start, end + 1)) as Record<string, any>;
    return Object.entries(json)
        .filter(([, d]) => d && typeof d === 'object' && d.installed !== false)
        .map(([name, d]) => ({
            name,
            version: String(d.version ?? ''),
            automationName: String(d.automationName ?? ''),
            platforms: Array.isArray(d.platformNames) ? d.platformNames.map(String) : [],
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
}
