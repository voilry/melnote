/**
 * The Acrylic system.
 *
 * One frosted-glass language for every surface that sits on the ambient avatar
 * backdrop of a profile: cards, wells, floating chrome and the selected segment
 * inside that chrome.
 *
 * The backdrop is not the avatar photo. It is an abstraction built from the
 * avatar's own colours, so text stays readable and the profile keeps its identity
 * without a literal face staring through the UI.
 *
 * House rules it obeys:
 * - No borders and no shadows (RULE 44 / RULE 4). Depth comes from surfaces and
 *   translucent washes, never outlines.
 * - Avatar colours are confined to the ambient backdrop. UI surfaces retain a
 *   fixed acrylic treatment in light and dark mode.
 */

import { shadeHex, type AvatarVibe } from './avatarVibe';

export interface AuraBlob {
    color: string;
    opacity: number;
}

export interface AcrylicAura {
    /** Base fill behind every colour pool. */
    base: string;
    /** Soft colour pools, painted back to front. */
    blobs: AuraBlob[];
}

export interface AcrylicPalette {
    /** Frosted card surface. */
    panel: string;
    /** Recessed fill for wells such as the note search field. */
    panelMuted: string;
    /** Floating chrome: profile tab bar, group chips, sticky header. */
    chrome: string;
    /** Selected segment inside floating chrome. */
    accent: string;
    /** Moving indicator inside the profile tab bar. */
    indicator: string;
    /** Avatar-derived ambient backdrop. Null until extraction finishes. */
    aura: AcrylicAura | null;
}

export const getAcrylicPalette = (
    colors: any,
    theme: 'light' | 'dark',
    vibe?: AvatarVibe | null
): AcrylicPalette => {
    const isDark = theme === 'dark';
    const background = colors.background;

    // Element colours are intentionally independent of the avatar. Acrylic has
    // its own fixed glass treatment: image colours belong to the background
    // only, while surfaces keep their original identity in both modes.
    const elementColours = isDark
        ? {
            panel: 'rgba(0,0,0,0.45)',
            panelMuted: 'rgba(0,0,0,0.34)',
            chrome: 'rgba(0,0,0,0.58)',
            accent: 'rgba(255,255,255,0.12)',
            indicator: 'rgba(255,255,255,0.05)',
        }
        : {
            panel: 'rgba(255,255,255,0.62)',
            panelMuted: 'rgba(255,255,255,0.48)',
            chrome: 'rgba(255,255,255,0.76)',
            accent: 'rgba(20,14,8,0.08)',
            indicator: 'rgba(20,14,8,0.08)',
        };

    if (!vibe) {
        return { ...elementColours, aura: null };
    }

    const { primary, secondary, accent: accentSeed } = vibe;

    // The ambient layer carries the avatar's identity. Dark mode lifts the
    // colours into soft pools; light mode deepens them so they remain visible
    // against the ivory base instead of turning into a faint stain.
    const aura: AcrylicAura = isDark
        ? {
            base: background,
            blobs: [
                { color: shadeHex(primary, 0.1), opacity: 0.3 },
                { color: shadeHex(secondary, 0.06), opacity: 0.24 },
                { color: shadeHex(accentSeed, 0.02), opacity: 0.18 },
            ],
        }
        : {
            base: background,
            blobs: [
                { color: shadeHex(primary, -0.06), opacity: 0.46 },
                { color: shadeHex(secondary, -0.04), opacity: 0.38 },
                { color: shadeHex(accentSeed, -0.02), opacity: 0.29 },
            ],
        };

    return { ...elementColours, aura };
};
