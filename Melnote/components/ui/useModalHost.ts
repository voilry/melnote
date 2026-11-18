import { useEffect, useState } from 'react';
import { AppState } from 'react-native';

/**
 * Keeps a native `Modal` usable across a trip to the background.
 *
 * Android pauses the drawing surface of a dialog while another activity is in
 * front of it, and resuming the activity only restarts the activity's own
 * surface - not the one inside a dialog. The dialog therefore comes back
 * blank, while still sitting on top and swallowing every touch. A dialog that
 * is created after the resume is fine, so this hook bumps a number whenever
 * the app comes back to the foreground.
 *
 * Pass that number as the `key` of the `Modal` and the dialog is torn down and
 * built again with a fresh surface:
 *
 *     const generation = useModalHost(visible);
 *     ...
 *     <Modal key={generation} visible={visible}>
 *
 * This is the same idea as `usePickerHost`, without the picker: it is for
 * sheets that stay open while the app goes away.
 */
export function useModalHost(visible: boolean): number {
    const [generation, setGeneration] = useState(0);

    useEffect(() => {
        if (!visible) return;

        // Only a real trip to the background needs a new surface. iOS reports
        // 'inactive' for the Control Centre and for permission alerts, and
        // those do not pause the dialog.
        let wentAway = false;

        const subscription = AppState.addEventListener('change', state => {
            if (state === 'background') {
                wentAway = true;
                return;
            }

            if (state === 'active' && wentAway) {
                wentAway = false;
                setGeneration(value => value + 1);
            }
        });

        return () => subscription.remove();
    }, [visible]);

    return generation;
}
