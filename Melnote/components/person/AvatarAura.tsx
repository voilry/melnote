import React from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, Ellipse, RadialGradient, Rect, Stop } from 'react-native-svg';
import type { AcrylicAura } from '../../utils/acrylic';

/**
 * An abstract colour field made from the avatar's palette.
 *
 * Three soft radial pools give the profile a sense of depth and identity
 * without a bitmap. SVG is used instead of stacked blurred views so the
 * gradient is rasterised once by the GPU and costs nothing while scrolling.
 */
export function AvatarAura({ aura }: { aura: AcrylicAura }) {
    const { width, height } = useWindowDimensions();
    const canvasHeight = Math.max(height, 1);

    const pools = [
        {
            cx: width * 0.12,
            cy: canvasHeight * 0.08,
            rx: width * 0.84,
            ry: canvasHeight * 0.46,
        },
        {
            cx: width * 0.96,
            cy: canvasHeight * 0.24,
            rx: width * 0.72,
            ry: canvasHeight * 0.42,
        },
        {
            cx: width * 0.44,
            cy: canvasHeight * 0.7,
            rx: width * 0.94,
            ry: canvasHeight * 0.5,
        },
    ];

    return (
        <View style={StyleSheet.absoluteFill} pointerEvents="none">
            <Svg width={width} height={canvasHeight} style={StyleSheet.absoluteFill}>
                <Defs>
                    {aura.blobs.map((blob, index) => (
                        <RadialGradient key={index} id={`avatar-aura-${index}`} cx="50%" cy="50%" r="50%">
                            <Stop offset="0" stopColor={blob.color} stopOpacity={blob.opacity} />
                            <Stop offset="0.58" stopColor={blob.color} stopOpacity={blob.opacity * 0.7} />
                            <Stop offset="1" stopColor={blob.color} stopOpacity={0} />
                        </RadialGradient>
                    ))}
                </Defs>

                <Rect width={width} height={canvasHeight} fill={aura.base} />

                {pools.map((pool, index) => {
                    const blob = aura.blobs[index];
                    if (!blob) return null;
                    return (
                        <Ellipse
                            key={index}
                            cx={pool.cx}
                            cy={pool.cy}
                            rx={pool.rx}
                            ry={pool.ry}
                            fill={`url(#avatar-aura-${index})`}
                        />
                    );
                })}
            </Svg>
        </View>
    );
}
