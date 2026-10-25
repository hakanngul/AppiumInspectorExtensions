import { Platform } from '../devices/types';

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Point {
    x: number;
    y: number;
}

/** One W3C touch pointer source (`POST /actions`), coordinates rounded to integers in the viewport. */
function finger(steps: unknown[]): unknown[] {
    return [{ type: 'pointer', id: 'finger1', parameters: { pointerType: 'touch' }, actions: steps }];
}

function move(p: Point, duration = 0) {
    return { type: 'pointerMove', duration, origin: 'viewport', x: Math.round(p.x), y: Math.round(p.y) };
}

export function tapActions(p: Point): unknown[] {
    return finger([move(p), { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 50 }, { type: 'pointerUp', button: 0 }]);
}

export function longPressActions(p: Point, ms = 800): unknown[] {
    return finger([move(p), { type: 'pointerDown', button: 0 }, { type: 'pause', duration: ms }, { type: 'pointerUp', button: 0 }]);
}

export function swipeActions(from: Point, to: Point, ms = 300): unknown[] {
    return finger([move(from), { type: 'pointerDown', button: 0 }, { type: 'pause', duration: 100 }, move(to, ms), { type: 'pointerUp', button: 0 }]);
}

/** A swipe across the middle of the screen; "up" moves the finger up, which scrolls the content down. */
export function swipeVector(size: { width: number; height: number }, direction: Direction): [Point, Point] {
    const cx = size.width / 2, cy = size.height / 2, dx = size.width / 4, dy = size.height / 4;
    switch (direction) {
        case 'up': return [{ x: cx, y: cy + dy }, { x: cx, y: cy - dy }];
        case 'down': return [{ x: cx, y: cy - dy }, { x: cx, y: cy + dy }];
        case 'left': return [{ x: cx + dx, y: cy }, { x: cx - dx, y: cy }];
        case 'right': return [{ x: cx - dx, y: cy }, { x: cx + dx, y: cy }];
    }
}

export interface MobileCommand {
    script: string;
    args: Record<string, unknown>;
}

/**
 * `mobile:` equivalents, used when the driver refuses W3C actions and in the recorded Java code. Names and parameters
 * from the UiAutomator2 8.7 and XCUITest 12.20 execute method maps; Android durations are milliseconds, iOS seconds.
 */
export const mobile = {
    tap(platform: Platform, p: Point): MobileCommand {
        const x = Math.round(p.x), y = Math.round(p.y);
        return platform === 'android' ? { script: 'mobile: clickGesture', args: { x, y } } : { script: 'mobile: tap', args: { x, y } };
    },
    longPress(platform: Platform, p: Point, ms = 800): MobileCommand {
        const x = Math.round(p.x), y = Math.round(p.y);
        return platform === 'android'
            ? { script: 'mobile: longClickGesture', args: { x, y, duration: ms } }
            : { script: 'mobile: touchAndHold', args: { x, y, duration: ms / 1000 } };
    },
    swipe(platform: Platform, from: Point, to: Point, ms = 300): MobileCommand {
        const [fx, fy, tx, ty] = [from.x, from.y, to.x, to.y].map(Math.round);
        return platform === 'android'
            ? { script: 'mobile: dragGesture', args: { startX: fx, startY: fy, endX: tx, endY: ty } }
            : { script: 'mobile: dragFromToForDuration', args: { fromX: fx, fromY: fy, toX: tx, toY: ty, duration: ms / 1000 } };
    },
    home(platform: Platform): MobileCommand {
        return platform === 'android' ? { script: 'mobile: pressKey', args: { keycode: 3 } } : { script: 'mobile: pressButton', args: { name: 'home' } };
    },
    /** Types into the focused field. */
    type(platform: Platform, text: string): MobileCommand {
        return platform === 'android' ? { script: 'mobile: type', args: { text } } : { script: 'mobile: keys', args: { keys: [text] } };
    },
};
