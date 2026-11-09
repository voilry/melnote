import {
    fallbackThemeColors,
    type MelnoteThemeColors,
} from './materialYouShared';

export type { MelnoteThemeColors } from './materialYouShared';

/**
 * iOS / web implementation of the Material You theme hook.
 *
 * `@expo/ui`'s Material 3 colors live in `@expo/ui/jetpack-compose`, which
 * loads an Android native module at import time. Importing that from a shared
 * module would crash on iOS and web, so Metro resolves `materialYou.android.ts`
 * on Android and this file everywhere else. Both expose the same surface.
 */
export function isMaterialYouSupported(): boolean {
    return false;
}

export function getMaterialYouThemeColors(
    theme: 'light' | 'dark',
    amoledEnabled: boolean = false
): MelnoteThemeColors {
    return fallbackThemeColors(theme, amoledEnabled);
}
