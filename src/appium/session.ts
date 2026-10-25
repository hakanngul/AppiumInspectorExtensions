import { DeviceInfo, Platform } from '../devices/types';
import { AppiumClient, AppiumError, Rect } from './client';
import { Direction, longPressActions, mobile, MobileCommand, Point, swipeActions, swipeVector, tapActions } from './gestures';
import { sanitizeXml } from './source';

export interface Capture {
    /** PNG data URL. */
    screenshot: string;
    /** Sanitised page source XML. */
    source: string;
    /** Window size in the driver's coordinate unit: pixels on Android, points on iOS. */
    window: Rect;
    ms: number;
}

export interface Locator {
    using: string;
    value: string;
}

/** One Appium session on one device; commands run one after another. */
export class InspectorSession {
    private queue: Promise<unknown> = Promise.resolve();
    private window?: Rect;
    private closed = false;

    private constructor(
        readonly client: AppiumClient,
        readonly id: string,
        readonly device: DeviceInfo,
        readonly capabilities: Record<string, unknown>,
        private readonly extensions: Set<string>,
    ) {}

    static async open(client: AppiumClient, device: DeviceInfo, caps: Record<string, unknown>): Promise<InspectorSession> {
        const created = await client.createSession(caps);
        const extensions = await client.extensionNames(created.sessionId).catch(() => new Set<string>());
        return new InspectorSession(client, created.sessionId, device, created.capabilities, extensions);
    }

    get platform(): Platform {
        return this.device.platform;
    }

    get isClosed(): boolean {
        return this.closed;
    }

    /** Runs commands in order: Appium serialises them per session anyway, and the UI must not interleave two reads. */
    private run<T>(task: () => Promise<T>): Promise<T> {
        const next = this.queue.then(task, task);
        this.queue = next.catch(() => undefined);
        return next;
    }

    /** Screenshot first (shown at once through onShot), then the window size and the page source. */
    capture(onShot: (screenshot: string) => void = () => undefined): Promise<Capture> {
        return this.run(async () => {
            const started = Date.now();
            const screenshot = await this.client.screenshot(this.id);
            onShot(screenshot);
            this.window = await this.client.windowRect(this.id);
            const source = sanitizeXml(await this.client.source(this.id));
            return { screenshot, source, window: this.window, ms: Date.now() - started };
        });
    }

    source(): Promise<string> {
        return this.run(async () => sanitizeXml(await this.client.source(this.id)));
    }

    tap(p: Point) {
        return this.gesture(tapActions(p), mobile.tap(this.platform, p));
    }

    longPress(p: Point) {
        return this.gesture(longPressActions(p), mobile.longPress(this.platform, p));
    }

    swipe(from: Point, to: Point) {
        return this.gesture(swipeActions(from, to), mobile.swipe(this.platform, from, to));
    }

    async swipeDirection(direction: Direction): Promise<[Point, Point]> {
        const size = this.window ?? (await this.run(() => this.client.windowRect(this.id)));
        const [from, to] = swipeVector(size, direction);
        await this.swipe(from, to);
        return [from, to];
    }

    back() {
        return this.run(() => this.client.back(this.id));
    }

    home() {
        const cmd = mobile.home(this.platform);
        return this.run(() => this.client.executeScript(this.id, cmd.script, cmd.args));
    }

    /** Types into the element the locator finds; without one, into the focused field. */
    type(text: string, locator?: Locator) {
        return this.run(async () => {
            if (locator) {
                const [elementId] = await this.client.findElements(this.id, locator.using, locator.value);
                if (elementId) {
                    await this.client.setValue(this.id, elementId, text);
                    return;
                }
            }
            const cmd = mobile.type(this.platform, text);
            await this.client.executeScript(this.id, cmd.script, cmd.args);
        });
    }

    /** Elements the server finds, with their rectangles (to mark them in the tree). */
    find(locator: Locator): Promise<Rect[]> {
        return this.run(async () => {
            const ids = await this.client.findElements(this.id, locator.using, locator.value);
            const rects: Rect[] = [];
            for (const id of ids.slice(0, 200)) {
                rects.push(await this.client.request<Rect>('GET', `/session/${encodeURIComponent(this.id)}/element/${encodeURIComponent(id)}/rect`));
            }
            return rects;
        });
    }

    count(locator: Locator): Promise<number> {
        return this.run(async () => (await this.client.findElements(this.id, locator.using, locator.value)).length);
    }

    /** W3C actions first; the `mobile:` extension when the driver refuses them. */
    private gesture(actions: unknown[], fallback: MobileCommand) {
        return this.run(async () => {
            try {
                await this.client.performActions(this.id, actions);
                await this.client.releaseActions(this.id).catch(() => undefined);
            } catch (e) {
                const refused = e instanceof AppiumError && ['unknown command', 'unsupported operation', 'unknown method'].includes(e.error);
                if (!refused || (this.extensions.size && !this.extensions.has(fallback.script))) {
                    throw e;
                }
                await this.client.executeScript(this.id, fallback.script, fallback.args);
            }
        });
    }

    /** Ends the session. The app keeps running (appium:shouldTerminateApp is false). */
    async close(): Promise<void> {
        if (this.closed) {
            return;
        }
        this.closed = true;
        await this.client.deleteSession(this.id).catch(() => undefined);
    }
}
