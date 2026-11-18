/**
 * Lets the app say "I am about to hand over to a system screen".
 *
 * The photo picker, the camera, the document picker and the share sheet all
 * take the app off the screen and bring it back. That looks exactly like the
 * owner leaving the app and coming back, so without a way to tell the two
 * apart the app lock would spring itself in the middle of a task the app
 * itself started - on top of the picture the user just picked, or on top of
 * the file they just chose.
 *
 * A flow announces itself before it opens and lets go when it is done. The
 * app lock asks `consumeExternalResume` when the app comes back, and skips
 * the lock once for a resume that belongs to a flow.
 *
 * The window is deliberately generous: the system screen can finish before
 * the app is told about it, and the two events travel over the bridge
 * separately, so either one can arrive first.
 */

/** How long after a system screen closes its resume still counts as its own. */
const SUPPRESSION_WINDOW_MS = 5000;

/** How many system screens are open right now. */
let depth = 0;

/** When the last system screen was opened or closed. */
let lastExternalAt = 0;

/** True while the app is inside a system screen it opened itself. */
export function isExternalActivityActive(): boolean {
    return depth > 0;
}

/**
 * Marks the start of a system screen. Call the returned function when it is
 * done - it is safe to call more than once.
 */
export function beginExternalActivity(): () => void {
    depth += 1;
    lastExternalAt = Date.now();

    let released = false;
    return () => {
        if (released) return;
        released = true;
        depth = Math.max(0, depth - 1);
        lastExternalAt = Date.now();
    };
}

/** Runs a task that opens a system screen, and always lets go afterwards. */
export async function runExternalActivity<T>(task: () => Promise<T>): Promise<T> {
    const release = beginExternalActivity();
    try {
        return await task();
    } finally {
        release();
    }
}

/**
 * Called by the app lock when the app comes back to the foreground after
 * really having been in the background.
 *
 * Returns true when the resume belongs to a system screen Melnote opened
 * itself, in which case the app must not lock.
 */
export function consumeExternalResume(): boolean {
    if (depth > 0) return true;

    if (lastExternalAt > 0 && Date.now() - lastExternalAt < SUPPRESSION_WINDOW_MS) {
        // The resume has been claimed, so it cannot be used a second time.
        lastExternalAt = 0;
        return true;
    }

    return false;
}
