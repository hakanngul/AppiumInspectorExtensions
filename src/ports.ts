import { execFile } from 'child_process';
import * as fs from 'fs';
import * as net from 'net';
import { run, toolEnv } from './process';

/** A TCP port in LISTEN state and the process that holds it. */
export interface PortUse {
    port: number;
    pid: number;
    command: string;
}

export interface WatchedPort {
    from: number;
    to: number;
    label: string;
}

/**
 * Ports an Appium session uses on this machine: the server, WebDriverAgent (wdaLocalPort, 8100 by default), the iOS
 * MJPEG screen stream (9100) and the UiAutomator2 server (systemPort, 8200-8299).
 */
export function watchedPorts(appiumPort: number): WatchedPort[] {
    return [
        { from: appiumPort, to: appiumPort, label: 'Appium server' },
        { from: 8100, to: 8199, label: 'WebDriverAgent (iOS)' },
        { from: 9100, to: 9100, label: 'MJPEG screen stream (iOS)' },
        { from: 8200, to: 8299, label: 'UiAutomator2 server (Android)' },
    ];
}

export function labelFor(port: number, watched: WatchedPort[]): string | undefined {
    return watched.find(w => port >= w.from && port <= w.to)?.label;
}

/** `lsof -nP -iTCP -sTCP:LISTEN -F pcn`: p<pid>, c<command>, then n<address:port> per socket (f<fd> lines skipped). */
export function parseLsof(stdout: string): PortUse[] {
    const out: PortUse[] = [];
    const seen = new Set<string>();
    let pid = 0;
    let command = '';
    for (const line of stdout.split(/\r?\n/)) {
        const tag = line[0];
        const value = line.slice(1);
        if (tag === 'p') {
            pid = Number(value);
            command = '';
        } else if (tag === 'c') {
            command = value;
        } else if (tag === 'n') {
            const port = Number(value.slice(value.lastIndexOf(':') + 1));
            const key = `${pid}:${port}`;
            if (pid && Number.isInteger(port) && port > 0 && !seen.has(key)) {
                seen.add(key);
                out.push({ port, pid, command });
            }
        }
    }
    return out.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** `netstat -ano -p tcp` (Windows): LISTENING rows; names come from `tasklist /FO CSV /NH`. */
export function parseNetstat(stdout: string, tasklist = ''): PortUse[] {
    const names = new Map<number, string>();
    for (const m of tasklist.matchAll(/^"([^"]*)","(\d+)"/gm)) {
        names.set(Number(m[2]), m[1]);
    }
    const out: PortUse[] = [];
    const seen = new Set<string>();
    for (const m of stdout.matchAll(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/gim)) {
        const port = Number(m[1]), pid = Number(m[2]);
        const key = `${pid}:${port}`;
        if (pid && !seen.has(key)) {
            seen.add(key);
            out.push({ port, pid, command: names.get(pid) ?? '' });
        }
    }
    return out.sort((a, b) => a.port - b.port || a.pid - b.pid);
}

/** Every listening TCP port on this machine with its process. */
export async function listListeners(): Promise<PortUse[]> {
    if (process.platform === 'win32') {
        const [ns, tl] = await Promise.all([run('netstat', ['-ano', '-p', 'tcp'], 10_000), run('tasklist', ['/FO', 'CSV', '/NH'], 10_000).catch(() => ({ stdout: '' }))]);
        return parseNetstat(ns.stdout, tl.stdout);
    }
    const env = await toolEnv();
    const lsof = ['/usr/sbin/lsof', '/usr/bin/lsof', '/bin/lsof'].find(p => fs.existsSync(p)) ?? 'lsof';
    return new Promise((resolve, reject) => {
        execFile(lsof, ['-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pcn'], { timeout: 10_000, env, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
            // lsof exits 1 when nothing listens; that is an empty list, not an error
            if (err && !(typeof err.code === 'number' && err.code === 1 && !String(stderr).trim())) {
                reject(new Error(`lsof failed: ${String(stderr).trim() || err.message}`));
            } else {
                resolve(parseLsof(String(stdout)));
            }
        });
    });
}

/** The listeners on Appium's ports, labelled. */
export async function appiumPortUses(appiumPort: number): Promise<(PortUse & { label: string })[]> {
    const watched = watchedPorts(appiumPort);
    return (await listListeners())
        .map(u => ({ ...u, label: labelFor(u.port, watched) ?? '' }))
        .filter(u => u.label);
}

/** True when nothing listens on the port (checked by binding it on the loopback address). */
export function isPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
    return new Promise(resolve => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.listen(port, host, () => server.close(() => resolve(true)));
    });
}

/** The first free port in the range, or undefined. */
export async function firstFreePort(from: number, to: number): Promise<number | undefined> {
    for (let port = from; port <= to; port++) {
        if (await isPortFree(port)) {
            return port;
        }
    }
    return undefined;
}

/** Stops a process: SIGTERM, then SIGKILL after the grace period; taskkill /T /F on Windows. */
export async function stopProcess(pid: number, graceMs = 3_000): Promise<void> {
    if (pid === process.pid || pid === process.ppid) {
        throw new Error('That is VS Code itself; it is not stopped from here.');
    }
    if (process.platform === 'win32') {
        await run('taskkill', ['/PID', String(pid), '/T', '/F'], 10_000);
        return;
    }
    const alive = () => {
        try {
            process.kill(pid, 0);
            return true;
        } catch {
            return false;
        }
    };
    process.kill(pid, 'SIGTERM');
    const deadline = Date.now() + graceMs;
    while (alive() && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
    }
    if (alive()) {
        process.kill(pid, 'SIGKILL');
    }
}
