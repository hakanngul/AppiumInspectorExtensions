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

let loginPath: Promise<string | undefined> | undefined;

/**
 * PATH as a login shell sets it. VS Code started from the Dock (macOS) or a desktop launcher does not inherit the PATH of
 * the user's shell profile, where Appium, adb and Homebrew usually live. Read once, then cached.
 */
export function loginShellPath(): Promise<string | undefined> {
    if (isWindows) {
        return Promise.resolve(undefined);
    }
    loginPath ??= new Promise(resolve => {
        const shell = process.env.SHELL || '/bin/zsh';
        execFile(shell, ['-ilc', 'printf "__PATH__%s__PATH__" "$PATH"'], { timeout: 5_000, env: process.env }, (err, stdout) => {
            const match = /__PATH__(.*)__PATH__/.exec(stdout ?? '');
            resolve(err && !match ? undefined : match?.[1]);
        });
    });
    return loginPath;
}

/** process.env with the login shell's PATH entries appended, for every tool this extension runs. */
export async function toolEnv(extra: NodeJS.ProcessEnv = {}): Promise<NodeJS.ProcessEnv> {
    const env = { ...process.env, ...extra };
    const login = await loginShellPath();
    if (login) {
        const key = Object.keys(env).find(k => k.toUpperCase() === 'PATH') ?? 'PATH';
        const parts = (env[key] ?? '').split(path.delimiter).filter(Boolean);
        for (const p of login.split(path.delimiter)) {
            if (p && !parts.includes(p)) {
                parts.push(p);
            }
        }
        env[key] = parts.join(path.delimiter);
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
