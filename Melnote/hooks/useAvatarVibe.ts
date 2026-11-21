import { useEffect, useState } from 'react';
import { InteractionManager } from 'react-native';
import {
    getAvatarVibe,
    getResolvedAvatarVibe,
    type AvatarVibe,
} from '../utils/avatarVibe';

type VibeState = {
    uri: string;
    vibe: AvatarVibe | null;
};

/**
 * Loads the colour palette for an avatar after the screen transition settles.
 *
 * Extraction is intentionally deferred: opening a profile should animate at
 * full frame rate, and the aura can fade in a moment later.
 */
export function useAvatarVibe(uri?: string | null): AvatarVibe | null {
    const [state, setState] = useState<VibeState | null>(() => {
        if (!uri) return null;
        const resolved = getResolvedAvatarVibe(uri);
        return resolved !== undefined ? { uri, vibe: resolved } : null;
    });

    useEffect(() => {
        if (!uri) {
            setState(null);
            return;
        }

        // Opening a profile preloads the palette, so the first committed paint
        // already has the final colours. Never recolour after that.
        const resolved = getResolvedAvatarVibe(uri);
        if (resolved !== undefined) {
            setState({ uri, vibe: resolved });
            return;
        }

        let cancelled = false;
        setState((current) => (current?.uri === uri ? current : { uri, vibe: null }));

        const task = InteractionManager.runAfterInteractions(() => {
            getAvatarVibe(uri)
                .then((vibe) => {
                    if (!cancelled) setState({ uri, vibe });
                })
                .catch(() => {
                    if (!cancelled) setState({ uri, vibe: null });
                });
        });

        return () => {
            cancelled = true;
            task.cancel();
        };
    }, [uri]);

    const current = uri ? getResolvedAvatarVibe(uri) : undefined;
    if (current !== undefined) return current;

    return state && state.uri === uri ? state.vibe : null;
}
