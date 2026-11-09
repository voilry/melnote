import { baseLightColors, baseDarkColors } from '../constants/Colors';

export type MelnoteThemeColors = typeof baseLightColors;

/**
 * The Material 3 roles we consume. `@expo/ui` hands back every value as an
 * `#RRGGBBAA` string; this type is deliberately plain `string` so the mapping
 * below stays free of any native import and can also run on iOS/web.
 */
export interface MaterialPalette {
    background: string;
    onBackground: string;
    surface: string;
    surfaceContainer: string;
    surfaceContainerLow: string;
    surfaceContainerHigh: string;
    onSurfaceVariant: string;
    outline: string;
    outlineVariant: string;
    primary: string;
    error: string;
}

/**
 * `#RRGGBBAA` -> `#RRGGBB`.
 *
 * The whole app appends a two-digit alpha suffix to theme tokens
 * (`colors.tint + '15'`). An 8-digit value would turn that into
 * `#RRGGBBAA15`, which RN rejects, so the alpha channel has to be dropped
 * before the value leaves this module. Every role is fully opaque anyway.
 */
export function normalizeHex(value: string): string {
    return /^#[0-9a-fA-F]{8}$/.test(value) ? value.slice(0, 7) : value;
}

export function fallbackThemeColors(
    theme: 'light' | 'dark',
    amoledEnabled: boolean = false
): MelnoteThemeColors {
    const base = theme === 'dark' ? baseDarkColors : baseLightColors;
    if (theme === 'dark' && amoledEnabled) {
        return {
            ...base,
            background: '#000000',
            card: '#161514',
            surface: '#22201F',
            border: '#3D3935',
        };
    }
    return { ...base };
}

/**
 * Maps the Material 3 semantic roles onto Melnote's design tokens.
 *
 * Tonal order is preserved from the previous 13-shade palette mapping:
 * background sits highest in light mode, then surface, then card.
 */
export function mapMaterialPalette(
    palette: MaterialPalette,
    theme: 'light' | 'dark',
    amoledEnabled: boolean = false
): MelnoteThemeColors {
    const base = theme === 'dark' ? baseDarkColors : baseLightColors;

    const pick = (key: keyof MaterialPalette, fallback: string): string => {
        const value = palette[key];
        return value ? normalizeHex(value) : fallback;
    };

    const background = pick('background', base.background);
    // Light: 98 bg > 96 low > 94 container. Dark: 10 bg < 12 container < 17 high.
    const surface = pick(theme === 'dark' ? 'surfaceContainerHigh' : 'surfaceContainerLow', base.surface);
    const card = pick('surfaceContainer', base.card);
    const border = pick('outlineVariant', base.border);
    const tint = pick('primary', base.tint);
    const text = pick('onBackground', base.text);
    const textSecondary = pick('onSurfaceVariant', base.textSecondary);
    const textTertiary = pick('outline', base.textTertiary);
    const icon = pick('onSurfaceVariant', base.icon);
    const error = pick('error', base.error);

    const colors: MelnoteThemeColors = {
        text,
        textSecondary,
        textTertiary,
        background,
        tint,
        icon,
        tabIconDefault: textTertiary,
        tabIconSelected: tint,
        border,
        card,
        surface,
        primary: text,
        secondary: textSecondary,
        error,
        warning: base.warning,
        success: base.success,
        info: base.info,
    };

    if (theme === 'dark' && amoledEnabled) {
        return {
            ...colors,
            background: '#000000',
            card: '#161514',
            surface: '#22201F',
            border: '#3D3935',
        };
    }

    return colors;
}
