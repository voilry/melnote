import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keeps a modal on screen for a beat after `visible` goes false so its
 * reanimated `exiting` animations can play before the native Modal is torn
 * down. Opening is untouched.
 *
 * - `mounted`: render the <Modal> while this is true.
 * - `showContent`: goes false the moment the modal starts closing, which
 *   removes the sheet (and its backdrop) from the tree inside the still-mounted
 *   Modal — that is what lets their exit animations run.
 */
export function useModalPresence(visible: boolean, exitMs = 340) {
    const [mounted, setMounted] = useState(visible);
    const [showContent, setShowContent] = useState(visible);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (visible) {
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
            setMounted(true);
            setShowContent(true);
            return;
        }

        if (!mounted) return;

        setShowContent(false);
        timer.current = setTimeout(() => {
            timer.current = null;
            setMounted(false);
        }, exitMs);

        return () => {
            if (timer.current) {
                clearTimeout(timer.current);
                timer.current = null;
            }
        };
    }, [visible, mounted, exitMs]);

    // For cases where the modal closes because the screen is navigating away:
    // the exit animation would play on top of the destination, so drop it.
    const hideNow = useCallback(() => {
        if (timer.current) {
            clearTimeout(timer.current);
            timer.current = null;
        }
        setShowContent(false);
        setMounted(false);
    }, []);

    return { mounted, showContent, hideNow };
}
