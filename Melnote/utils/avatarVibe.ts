/**
 * Avatar colour extraction.
 *
 * The acrylic profile does not show the avatar photo anymore. Instead it takes
 * the colours that are already in the avatar and turns them into an ambient
 * palette for the profile.
 *
 * The pipeline is deliberately small:
 *   1. The native image manipulator shrinks the avatar to a 24px JPEG.
 *   2. `jpeg-js` decodes that tiny bitmap on the JS thread.
 *   3. A weighted k-means picks the colours that carry the most visual weight.
 *
 * Working at 24px keeps decoding in the low milliseconds and avoids putting a
 * full-resolution bitmap on the JS heap. Results are cached per URI because the
 * avatar path changes whenever the user picks a new photo.
 */

import { decode as decodeJpeg } from 'jpeg-js';
import * as FileSystem from 'expo-file-system/legacy';

export interface AvatarVibe {
    /** Colour with the strongest visual presence. */
    primary: string;
    /** A clearly different colour from the image. */
    secondary: string;
    /** Third colour, used for the furthest ambient pool. */
    accent: string;
}

type Rgb = { r: number; g: number; b: number };
type Hsl = { h: number; s: number; l: number };

type Sample = Rgb & {
    weight: number;
    saturation: number;
    lightness: number;
};

type Cluster = Rgb & {
    weight: number;
    count: number;
};

const SAMPLE_SIZE = 24;
const CLUSTER_COUNT = 5;
const CACHE_LIMIT = 32;
const CACHE = new Map<string, Promise<AvatarVibe | null>>();
const RESOLVED = new Map<string, AvatarVibe | null>();

type ImageManipulatorModule = typeof import('expo-image-manipulator');

let manipulatorModule: ImageManipulatorModule | null | undefined;

function getImageManipulator(): ImageManipulatorModule | null {
    if (manipulatorModule === undefined) {
        try {
            manipulatorModule = require('expo-image-manipulator') as ImageManipulatorModule;
        } catch {
            manipulatorModule = null;
        }
    }
    return manipulatorModule;
}

/**
 * Returns a cached, avatar-derived palette.
 *
 * A failed extraction is cached as `null` so a broken or unsupported image is
 * not decoded again on every render.
 */
export function getAvatarVibe(uri: string): Promise<AvatarVibe | null> {
    const hit = CACHE.get(uri);
    if (hit) return hit;

    const request = extractAvatarVibe(uri)
        .catch((error) => {
            console.warn('Could not derive avatar colours:', error);
            return null;
        })
        .then((vibe) => {
            RESOLVED.set(uri, vibe);
            return vibe;
        });

    CACHE.set(uri, request);
    if (CACHE.size > CACHE_LIMIT) {
        const oldest = CACHE.keys().next().value;
        if (oldest) {
            CACHE.delete(oldest);
            RESOLVED.delete(oldest);
        }
    }

    return request;
}

/**
 * Synchronous cache read for screens that preloaded the palette before
 * rendering. `undefined` means "not extracted yet", while `null` means
 * "extraction finished without a usable palette".
 */
export function getResolvedAvatarVibe(uri: string): AvatarVibe | null | undefined {
    return RESOLVED.get(uri);
}

async function extractAvatarVibe(uri: string): Promise<AvatarVibe | null> {
    const manipulator = getImageManipulator();
    if (!manipulator) return null;

    const manipulated = manipulator.ImageManipulator.manipulate(uri).resize({
        width: SAMPLE_SIZE,
    });
    const rendered = await manipulated.renderAsync();
    const saved = await rendered.saveAsync({
        base64: true,
        compress: 0.85,
        format: manipulator.SaveFormat.JPEG,
    });

    // The manipulated file is a throwaway cache entry; only the base64 matters.
    FileSystem.deleteAsync(saved.uri, { idempotent: true }).catch(() => { });

    if (!saved.base64) return null;

    const base64 = saved.base64.includes(',')
        ? saved.base64.slice(saved.base64.indexOf(',') + 1)
        : saved.base64;

    let decoded;
    try {
        decoded = decodeJpeg(base64ToBytes(base64), {
            useTArray: true,
            formatAsRGBA: true,
            maxResolutionInMP: 2,
            maxMemoryUsageInMB: 8,
        });
    } catch {
        return null;
    }

    if (!decoded || !decoded.data) return null;

    return paletteFromPixels(decoded.data, decoded.width, decoded.height);
}

function paletteFromPixels(data: Uint8Array, width: number, height: number): AvatarVibe | null {
    const samples: Sample[] = [];
    const pixels = width * height;

    for (let i = 0; i < pixels; i++) {
        const offset = i * 4;
        const r = data[offset];
        const g = data[offset + 1];
        const b = data[offset + 2];
        const { s, l } = rgbToHsl(r, g, b);

        // Prefer pixels that carry hue. Near-white, near-black and grey pixels
        // still count, but only as background weight.
        let weight = 0.2 + s * 2.1;
        weight *= 0.3 + Math.max(0, 1 - Math.abs(l - 0.5) * 1.35) * 0.9;
        if (l < 0.07 || l > 0.95) weight *= 0.16;
        if (s < 0.06) weight *= 0.42;

        samples.push({ r, g, b, weight, saturation: s, lightness: l });
    }

    if (samples.length === 0) return null;

    const clusters = kMeans(samples, Math.min(CLUSTER_COUNT, samples.length));
    if (clusters.length === 0) return null;

    const ranked = [...clusters].sort((a, b) => clusterScore(b) - clusterScore(a));
    const primary = ranked[0];
    const secondary = pickDistinct(ranked, [primary], 44) ?? fallbackShift(primary, 18);
    const accent = pickDistinct(ranked, [primary, secondary], 36) ?? fallbackShift(secondary, -26);

    return {
        primary: polishSwatch(rgbToHex(primary), 0.2),
        secondary: polishSwatch(rgbToHex(secondary), 0.26),
        accent: polishSwatch(rgbToHex(accent), 0.3),
    };
}

/**
 * K-means averages tend toward mud: the mean of a photo's reds and browns is a
 * flatter brown than either. Push saturation back up and keep the colour out of
 * the near-black / near-white ends so it survives being laid over a surface.
 */
function polishSwatch(hex: string, saturationBoost: number): string {
    const rgb = parseHex(hex);
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

    // A genuinely grey avatar has no hue to recover. Inventing one would no
    // longer be "the avatar's colours".
    if (s < 0.09) return hex;

    const saturation = Math.min(0.9, s + (1 - s) * saturationBoost);
    const lightness = Math.max(0.3, Math.min(0.7, l));
    return rgbToHex(hslToRgb(h, saturation, lightness));
}

function kMeans(samples: Sample[], count: number): Cluster[] {
    if (count <= 0) return [];

    const centroids: Rgb[] = [];
    const first = samples.reduce((best, sample) => (sample.weight > best.weight ? sample : best), samples[0]);
    centroids.push({ r: first.r, g: first.g, b: first.b });

    while (centroids.length < count) {
        let bestSample: Sample | null = null;
        let bestScore = -1;

        for (const sample of samples) {
            const nearest = Math.min(...centroids.map((centroid) => colorDistanceSquared(sample, centroid)));
            const score = sample.weight * (nearest + 1);
            if (score > bestScore) {
                bestScore = score;
                bestSample = sample;
            }
        }

        if (!bestSample || bestScore < 0.00001) break;
        centroids.push({ r: bestSample.r, g: bestSample.g, b: bestSample.b });
    }

    // Seven passes is enough for a 24px source and keeps this deterministic.
    for (let pass = 0; pass < 7; pass++) {
        const sums = centroids.map(() => ({ r: 0, g: 0, b: 0, weight: 0, count: 0 }));

        for (const sample of samples) {
            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;

            for (let i = 0; i < centroids.length; i++) {
                const distance = colorDistanceSquared(sample, centroids[i]);
                if (distance < nearestDistance) {
                    nearestDistance = distance;
                    nearestIndex = i;
                }
            }

            const sum = sums[nearestIndex];
            sum.r += sample.r * sample.weight;
            sum.g += sample.g * sample.weight;
            sum.b += sample.b * sample.weight;
            sum.weight += sample.weight;
            sum.count += 1;
        }

        for (let i = 0; i < centroids.length; i++) {
            const sum = sums[i];
            if (sum.weight > 0) {
                centroids[i] = {
                    r: sum.r / sum.weight,
                    g: sum.g / sum.weight,
                    b: sum.b / sum.weight,
                };
            }
        }

        if (pass === 6) {
            return centroids.map((centroid, index) => ({
                r: Math.round(centroid.r),
                g: Math.round(centroid.g),
                b: Math.round(centroid.b),
                weight: sums[index].weight,
                count: sums[index].count,
            }));
        }
    }

    return centroids.map((centroid) => ({
        r: Math.round(centroid.r),
        g: Math.round(centroid.g),
        b: Math.round(centroid.b),
        weight: 0,
        count: 1,
    }));
}

function clusterScore(cluster: Cluster): number {
    const { s, l } = rgbToHsl(cluster.r, cluster.g, cluster.b);
    const midLightBonus = 0.35 + Math.max(0, 1 - Math.abs(l - 0.5) * 1.5) * 0.9;
    return cluster.weight * (0.3 + s * 1.55) * midLightBonus;
}

function pickDistinct(clusters: Cluster[], chosen: Cluster[], minimumDistance: number): Cluster | null {
    for (const cluster of clusters) {
        if (chosen.includes(cluster)) continue;
        const farEnough = chosen.every((item) => colorDistance(cluster, item) >= minimumDistance);
        if (farEnough) return cluster;
    }
    return clusters.find((cluster) => !chosen.includes(cluster)) ?? null;
}

function fallbackShift(cluster: Cluster, hueShift: number): Cluster {
    const { h, s, l } = rgbToHsl(cluster.r, cluster.g, cluster.b);
    const shifted = hslToRgb((h + hueShift + 360) % 360, Math.max(0.24, Math.min(0.72, s)), l);
    return { ...shifted, weight: cluster.weight * 0.5, count: 1 };
}

function colorDistanceSquared(a: Rgb, b: Rgb): number {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return dr * dr + dg * dg + db * db;
}

function colorDistance(a: Rgb, b: Rgb): number {
    return Math.sqrt(colorDistanceSquared(a, b));
}

function rgbToHsl(r: number, g: number, b: number): Hsl {
    const red = r / 255;
    const green = g / 255;
    const blue = b / 255;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const lightness = (max + min) / 2;

    if (max === min) return { h: 0, s: 0, l: lightness };

    const delta = max - min;
    const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    let hue = 0;

    if (max === red) hue = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;

    return { h: hue * 60, s: saturation, l: lightness };
}

function hslToRgb(h: number, s: number, l: number): Rgb {
    const chroma = (1 - Math.abs(2 * l - 1)) * s;
    const section = h / 60;
    const x = chroma * (1 - Math.abs((section % 2) - 1));

    let r = 0;
    let g = 0;
    let b = 0;

    if (section < 1) [r, g, b] = [chroma, x, 0];
    else if (section < 2) [r, g, b] = [x, chroma, 0];
    else if (section < 3) [r, g, b] = [0, chroma, x];
    else if (section < 4) [r, g, b] = [0, x, chroma];
    else if (section < 5) [r, g, b] = [x, 0, chroma];
    else [r, g, b] = [chroma, 0, x];

    const match = l - chroma / 2;
    return {
        r: Math.round((r + match) * 255),
        g: Math.round((g + match) * 255),
        b: Math.round((b + match) * 255),
    };
}

function rgbToHex({ r, g, b }: Rgb): string {
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

function toHex(value: number): string {
    return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
}

/** Parses the first six digits of a hex colour. */
export function parseHex(hex: string): Rgb {
    const clean = hex.replace('#', '');
    const expanded = clean.length === 3
        ? clean.split('').map((char) => char + char).join('')
        : clean;
    const value = parseInt(expanded.slice(0, 6), 16);
    if (!Number.isFinite(value)) return { r: 0, g: 0, b: 0 };
    return {
        r: (value >> 16) & 255,
        g: (value >> 8) & 255,
        b: value & 255,
    };
}

/** Mixes `amount` (0-1) of `target` into `source`. */
export function mixHex(source: string, target: string, amount: number): string {
    const t = Math.max(0, Math.min(1, amount));
    const a = parseHex(source);
    const b = parseHex(target);
    return rgbToHex({
        r: a.r + (b.r - a.r) * t,
        g: a.g + (b.g - a.g) * t,
        b: a.b + (b.b - a.b) * t,
    });
}

/** Lightens (positive) or darkens (negative) a colour. */
export function shadeHex(hex: string, amount: number): string {
    return amount >= 0 ? mixHex(hex, '#FFFFFF', amount) : mixHex(hex, '#000000', -amount);
}

/** Appends an alpha channel. Accepts 0-1 or a two-character hex value. */
export function withAlpha(hex: string, alpha: number | string): string {
    const channel = typeof alpha === 'number'
        ? Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, '0')
        : alpha.replace('#', '').slice(0, 2).padStart(2, '0');
    const clean = hex.replace('#', '');
    const expanded = clean.length === 3
        ? clean.split('').map((char) => char + char).join('')
        : clean;
    return `#${expanded.slice(0, 6)}${channel}`.toUpperCase();
}

function base64ToBytes(input: string): Uint8Array {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const lookup = new Int16Array(256).fill(-1);
    for (let i = 0; i < alphabet.length; i++) lookup[alphabet.charCodeAt(i)] = i;

    const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
    const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
    let buffer = 0;
    let bits = 0;
    let index = 0;

    for (let i = 0; i < clean.length; i++) {
        const value = lookup[clean.charCodeAt(i)];
        if (value < 0) continue;
        buffer = (buffer << 6) | value;
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            bytes[index++] = (buffer >> bits) & 255;
            buffer &= (1 << bits) - 1;
        }
    }

    return bytes.subarray(0, index);
}
