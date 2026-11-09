import { Platform } from 'react-native';
import { getMaterialColors, isDynamicColorAvailable } from '@expo/ui/jetpack-compose';
import { baseLightColors } from '../constants/Colors';
import {
    fallbackThemeColors,
    mapMaterialPalette,
    type MaterialPalette,
    type MelnoteThemeColors,
} from './materialYouShared';

export type { MelnoteThemeColors } from './materialYouShared';

/**
 * Checks if native Material You dynamic theming is supported on this device
 * (Android 12+ with wallpaper-based colors).
 */
export function isMaterialYouSupported(): boolean {
    return Platform.OS === 'android' && isDynamicColorAvailable;
}

/**
 * Reads the palette straight from the platform.
 *
 * When wallpaper colors are unavailable (Android < 12) we seed the palette
 * with Melnote's amber tint so the theme still looks intentional instead of
 * falling back to the static Material baseline. On Android 12+ the seed is
 * ignored and the wallpaper palette is used, which is what the old
 * `getMaterialYouPalette(seed, 'TONAL_SPOT')` call did too.
 */
function resolvePalette(theme: 'light' | 'dark'): MaterialPalette | null {
    if (Platform.OS !== 'android') return null;
    try {
        return getMaterialColors(
            isDynamicColorAvailable
                ? { scheme: theme }
                : { scheme: theme, seedColor: baseLightColors.tint }
        );
    } catch {
        return null;
    }
}

export function getMaterialYouThemeColors(
    theme: 'light' | 'dark',
    amoledEnabled: boolean = false
): MelnoteThemeColors {
    const palette = resolvePalette(theme);
    if (!palette) {
        return fallbackThemeColors(theme, amoledEnabled);
    }
    return mapMaterialPalette(palette, theme, amoledEnabled);
}
