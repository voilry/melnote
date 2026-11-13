import type { ImageAlign } from './markdownConverter';

/**
 * Live state of the selected image, streamed from the editor WebView.
 * `pos` is a ProseMirror document position and only meaningful web-side.
 */
export interface ImageSelection {
    active: boolean;
    pos: number;
    src: string;
    width: number;
    align: ImageAlign;
    caption: string;
}

/** Attribute update understood by the editor bridge (percentage + alignment). */
export interface ImageAttrUpdate {
    width?: number;
    align?: ImageAlign;
    title?: string;
    src?: string;
}

export const IMAGE_ALIGN_CODE: Record<ImageAlign, number> = {
    left: 1,
    center: 2,
    right: 3,
};

function normalizeAlign(value: unknown): ImageAlign {
    return value === 'left' || value === 'right' ? value : 'center';
}

/** Validates the `melnote-image-selection` payload; null means "no selection". */
export function imageSelectionFromMessage(value: unknown): ImageSelection | null {
    if (!value || typeof value !== 'object') return null;
    const payload = value as Record<string, unknown>;
    if (payload.active !== true) return null;

    const rawWidth = Number(payload.width);
    const width = Number.isFinite(rawWidth)
        ? Math.max(20, Math.min(100, Math.round(rawWidth)))
        : 100;

    return {
        active: true,
        pos: Number(payload.pos) || 0,
        src: typeof payload.src === 'string' ? payload.src : '',
        width,
        align: normalizeAlign(payload.align),
        caption: typeof payload.caption === 'string' ? payload.caption : '',
    };
}
