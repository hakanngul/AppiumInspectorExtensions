import { ChildProcess, execFile, spawn, SpawnOptions } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const isWindows = process.platform === 'win32';

export interface RunResult {
    stdout: string;
    stderr: string;
}

export class ToolNotFoundError extends Error {
    constructor(readonly tool: string) {
        super(`'${tool}' was not found`);
    }
}

const LOGIN_VARS = ['PATH', 'ANDROID_HOME', 'ANDROID_SDK_ROOT', 'JAVA_HOME'];
let loginVars: Promise<Record<string, string>> | undefined;

/**
 * PATH, ANDROID_HOME, ANDROID_SDK_ROOT and JAVA_HOME as a login shell sets them. VS Code started from the Dock (macOS)
 * or a desktop launcher does not inherit the user's shell profile, where Appium, adb, the Android SDK and Java are
 * usually set up. Read once, then cached.
 */
export function loginShellEnv(): Promise<Record<string, string>> {
    if (isWindows) {
        return Promise.resolve({});
    }
    loginVars ??= new Promise(resolve => {
        const shell = process.env.SHELL || '/bin/zsh';
        const script = `for v in ${LOGIN_VARS.join(' ')}; do printf "__ENV__%s=%s\\n" "$v" "$(printenv "$v")"; done`;
        execFile(shell, ['-ilc', script], { timeout: 5_000, env: process.env }, (_err, stdout) => {
            const vars: Record<string, string> = {};
            for (const m of String(stdout ?? '').matchAll(/^__ENV__(\w+)=(.*)$/gm)) {
                if (m[2]) {
                    vars[m[1]] = m[2];
                }
            }
            resolve(vars);
        });
    });
    return loginVars;
}

/** Where Android Studio installs the SDK by default. */
export function defaultAndroidSdk(home = process.env.HOME || process.env.USERPROFILE || '', platform = process.platform): string {
    return platform === 'darwin' ? path.join(home, 'Library', 'Android', 'sdk')
        : platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Android', 'Sdk')
            : path.join(home, 'Android', 'Sdk');
}

let javaHome: Promise<string | undefined> | undefined;

/** A JDK when JAVA_HOME is unset: macOS java_home, then the JBR bundled with Android Studio. */
function findJavaHome(): Promise<string | undefined> {
    javaHome ??= new Promise(resolve => {
        const studio = ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/Applications/Android Studio.app/Contents/jre/Contents/Home'];
        const fallback = () => resolve(studio.find(p => fs.existsSync(path.join(p, 'bin', 'java'))));
        if (process.platform !== 'darwin') {
            return fallback();
        }
        execFile('/usr/libexec/java_home', [], { timeout: 5_000 }, (err, stdout) => (err || !String(stdout).trim() ? fallback() : resolve(String(stdout).trim())));
    });
    return javaHome;
}

/**
 * process.env for every tool this extension runs, Appium included: the login shell's PATH entries appended, and
 * ANDROID_HOME / ANDROID_SDK_ROOT / JAVA_HOME filled in when VS Code did not get them (UiAutomator2 needs both).
 */
export async function toolEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
    const env = { ...process.env, ...extra };
    const login = await loginShellEnv();
    const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
    const parts = (env[key] ?? '').split(path.delimiter).filter(Boolean);
    for (const p of (login.PATH ?? '').split(path.delimiter)) {
        if (p && !parts.includes(p)) {
            parts.push(p);
        }
    }
    env[key] = parts.join(path.delimiter);
    for (const name of ['ANDROID_HOME', 'ANDROID_SDK_ROOT', 'JAVA_HOME']) {
        if (!env[name] && login[name]) {
            env[name] = login[name];
        }
    }
    if (!env.ANDROID_HOME && !env.ANDROID_SDK_ROOT && fs.existsSync(defaultAndroidSdk())) {
        env.ANDROID_HOME = defaultAndroidSdk();
    }
    if (!env.JAVA_HOME) {
        const java = await findJavaHome();
        if (java) {
            env.JAVA_HOME = java;
        }
    }
    return env;
}

/** The executable's absolute path: a path is checked as is, a bare name is looked up on PATH (with PATHEXT on Windows). */
export function resolveExecutable(command: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
    const exts = isWindows ? ['', ...(env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map(e => e.toLowerCase())] : [''];
    const candidates = (dir: string) => exts.map(ext => path.join(dir, command + ext));
    if (command.includes('/') || command.includes('\\')) {
        return [command, ...exts.slice(1).map(ext => command + ext)].find(isFile);
    }
    const pathKey = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
    for (const dir of (env[pathKey] ?? '').split(path.delimiter).filter(Boolean)) {
        const hit = candidates(dir).find(isFile);
        if (hit) {
            return hit;
        }
    }
    return undefined;
}

function isFile(p: string): boolean {
    try {
        return fs.statSync(p).isFile();
    } catch {
        return false;
    }
}

interface Launch {
    file: string;
    args: string[];
    shell: boolean;
}

/**
 * How to start a resolved executable. On Windows npm installs CLIs as `.cmd` shims, which Node refuses to spawn without a
 * shell (EINVAL since Node 18.20.2). For the Appium shim the package's own entry point is run with node instead; any other
 * `.cmd` goes through the shell with quoted arguments.
 */
export function launchFor(resolved: string, args: string[], platform = process.platform): Launch {
    if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(resolved)) {
        return { file: resolved, args, shell: false };
    }
    const entry = path.join(path.dirname(resolved), 'node_modules', 'appium', 'index.js');
    if (/^appium\.cmd$/i.test(path.basename(resolved)) && isFile(entry)) {
        return { file: 'node', args: [entry, ...args], shell: false };
    }
    return { file: quoteWindows(resolved), args: args.map(quoteWindows), shell: true };
}

/** Quotes one argument for cmd.exe. Arguments come from settings validated elsewhere; cmd metacharacters are refused. */
export function quoteWindows(arg: string): string {
    if (/["%^&|<>!\r\n]/.test(arg)) {
        throw new Error(`Unsafe character in argument for cmd.exe: ${arg}`);
    }
    return /[\s()]/.test(arg) || arg === '' ? `"${arg}"` : arg;
}

/** Runs a tool to completion and returns its output; a missing tool is a ToolNotFoundError. */
export async function run(command: string, args: string[], timeoutMs = 15_000, env?: NodeJS.ProcessEnv): Promise<RunResult> {
    const e = env ?? (await toolEnv());
    const resolved = resolveExecutable(command, e);
    if (!resolved) {
        throw new ToolNotFoundError(command);
    }
    const l = launchFor(resolved, args);
    return new Promise((resolve, reject) => {
        execFile(l.file, l.args, { timeout: timeoutMs, env: e, shell: l.shell, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
            if (err) {
                const detail = (stderr || stdout || '').toString().trim().split('\n').slice(-3).join(' ');
                reject(new Error(`${path.basename(command)} ${args.join(' ')} failed: ${detail || err.message}`));
            } else {
                resolve({ stdout: stdout.toString(), stderr: stderr.toString() });
            }
        });
    });
}

/** Starts a long-running tool in its own process group (POSIX), so that killTree stops its children too. */
export async function start(command: string, args: string[], env?: NodeJS.ProcessEnv): Promise<ChildProcess> {
    const e = env ?? (await toolEnv());
    const resolved = resolveExecutable(command, e);
    if (!resolved) {
        throw new ToolNotFoundError(command);
    }
    const l = launchFor(resolved, args);
    const options: SpawnOptions = { env: e, shell: l.shell, detached: !isWindows, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true };
    return spawn(l.file, l.args, options);
}

/** Stops a process and its children: SIGTERM to the group, SIGKILL after the grace period; taskkill /T on Windows. */
export async function killTree(child: ChildProcess, graceMs = 5_000): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        return;
    }
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
    if (isWindows) {
        await new Promise<void>(resolve => execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => resolve()));
        await Promise.race([exited, delay(graceMs)]);
        return;
    }
    signalGroup(child, 'SIGTERM');
    const done = await Promise.race([exited.then(() => true), delay(graceMs).then(() => false)]);
    if (!done) {
        signalGroup(child, 'SIGKILL');
        await Promise.race([exited, delay(1_000)]);
    }
}

/** Synchronous best effort for deactivate(), where nothing can be awaited for long. */
export function killTreeNow(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null || child.pid === undefined) {
        return;
    }
    if (isWindows) {
        execFile('taskkill', ['/PID', String(child.pid), '/T', '/F'], () => undefined);
    } else {
        signalGroup(child, 'SIGTERM');
    }
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals) {
    try {
        process.kill(-child.pid!, signal);
    } catch {
        try {
            child.kill(signal);
        } catch {
            // already gone
        }
    }
}

export function delay(ms: number): Promise<void> {
    return new Promise(r => setTimeout(r, ms));
}
