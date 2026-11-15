import type { View } from 'react-native';

/** Window-space rect of the card a screen should grow out of. */
export interface ExpandOrigin {
    x: number;
    y: number;
    width: number;
    height: number;
    radius: number;
}

let pending: ExpandOrigin | null = null;

/** Called by a list right before navigating to the destination screen. */
export function setPendingExpandOrigin(origin: ExpandOrigin | null) {
    pending = origin;
}

/** Read-once: the destination consumes the origin while mounting. */
export function takePendingExpandOrigin(): ExpandOrigin | null {
    const origin = pending;
    pending = null;
    return origin;
}

/** Measures a card in window coordinates and reports its rect (or null). */
export function measureExpandOrigin(
    node: View | null,
    radius: number,
    done: (origin: ExpandOrigin | null) => void
) {
    if (!node) {
        done(null);
        return;
    }
    try {
        node.measureInWindow((x, y, width, height) => {
            if (!width || !height) {
                done(null);
                return;
            }
            done({ x, y, width, height, radius });
        });
    } catch {
        done(null);
    }
}
