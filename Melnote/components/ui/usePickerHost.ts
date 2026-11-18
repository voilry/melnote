import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { pickImageFromLibrary } from '../../utils/imagePicker';

/**
 * Opens the system photo picker from a screen that is shown in a `Modal`.
 *
 * The sheet stays on screen for the whole pick, so the system picker slides
 * in over the sheet instead of over the screen behind it. Nothing is hidden
 * while the picker is opening, which is what used to flash the people list.
 *
 * Android pauses the drawing surface of a dialog while another activity is in
 * front of it, and resuming the activity only restarts the activity's own
 * surface - not the one inside a dialog. The dialog therefore comes back
 * blank, while still sitting on top and swallowing every touch. A dialog that
 * is created after the resume is fine, so this hook recreates the `Modal` once
 * the app is back in the foreground, which gives it a fresh surface.
 *
 * Returns:
 *
 * - `generation`: pass it as the `key` of the `Modal`. Bumping it tears the
 *   dialog down and builds a new one in the same commit.
 * - `pick()`: runs one picker round trip and resolves with the picked uri.
 */
export function usePickerHost() {
    const [generation, setGeneration] = useState(0);

    const pick = useCallback(async () => {
        let finished = false;
        let rebuilt = false;
        let subscription: { remove: () => void } | null = null;

        const rebuildWhenReady = () => {
            // Both have to hold: the pick has to be over, and the app has to
            // be in the foreground again. Rebuilding while the activity is
            // still paused would hand the resume a brand new dialog to patch,
            // which is the thing we are trying to avoid.
            if (rebuilt || !finished || AppState.currentState !== 'active') return;

            rebuilt = true;
            subscription?.remove();
            subscription = null;
            setGeneration(value => value + 1);
        };

        subscription = AppState.addEventListener('change', (state) => {
            if (state === 'active') rebuildWhenReady();
        });

        try {
            return await pickImageFromLibrary();
        } finally {
            finished = true;
            rebuildWhenReady();
        }
    }, []);

    return { generation, pick };
}
