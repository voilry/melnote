import React from 'react';
import { Platform, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated';
import type { ExpandOrigin } from '../../utils/expandTransition';

/**
 * Android screen-open transition: a solid surface grows out of the tapped card
 * to fill the screen, then cross-fades into the real content.
 *
 * Only the plain surface rectangle is animated — never the (text-heavy) screen
 * itself — so Android never re-rasterises the content at fractional scales and
 * the transition stays smooth. iOS keeps its native fade, so this renders a
 * plain passthrough there.
 */
const EXPAND_DURATION = 300;
const CONTENT_DELAY = 260;
const CONTENT_DURATION = 200;
const SURFACE_FADE_DELAY = 300;
const SURFACE_FADE_DURATION = 150;
const FALLBACK_FADE_DURATION = 180;

interface ScreenExpandProps {
    /** Where the screen should start growing from. Null for deep links/remounts. */
    origin: ExpandOrigin | null;
    /** Screen background colour, so the surface is invisible once expanded. */
    color: string;
    children: React.ReactNode;
}

export function ScreenExpand({ origin, color, children }: ScreenExpandProps) {
    const { width: winW, height: winH } = useWindowDimensions();
    const animate = Platform.OS === 'android' && origin !== null;
    // A card deep link has nothing to grow out of, so fade the content in
    // instead of snapping it onto the screen.
    const fallback = Platform.OS === 'android' && origin === null;

    const [surfaceGone, setSurfaceGone] = React.useState(!animate);

    const x = useSharedValue(origin?.x ?? 0);
    const y = useSharedValue(origin?.y ?? 0);
    const width = useSharedValue(origin?.width ?? winW);
    const height = useSharedValue(origin?.height ?? winH);
    const radius = useSharedValue(origin?.radius ?? 0);
    const contentOpacity = useSharedValue(animate || fallback ? 0 : 1);
    const surfaceOpacity = useSharedValue(1);

    React.useEffect(() => {
        if (fallback) {
            contentOpacity.value = withTiming(1, {
                duration: FALLBACK_FADE_DURATION,
                easing: Easing.out(Easing.quad),
            });
            return;
        }
        if (!animate) return;

        const expand = {
            duration: EXPAND_DURATION,
            easing: Easing.bezier(0.05, 0.7, 0.1, 1.0),
        };
        x.value = withTiming(0, expand);
        y.value = withTiming(0, expand);
        width.value = withTiming(winW, expand);
        height.value = withTiming(winH, expand);
        radius.value = withTiming(0, expand);

        contentOpacity.value = withDelay(
            CONTENT_DELAY,
            withTiming(1, { duration: CONTENT_DURATION, easing: Easing.out(Easing.quad) })
        );
        surfaceOpacity.value = withDelay(
            SURFACE_FADE_DELAY,
            withTiming(0, { duration: SURFACE_FADE_DURATION }, finished => {
                if (finished) runOnJS(setSurfaceGone)(true);
            })
        );
    }, [animate, fallback, winW, winH, x, y, width, height, radius, contentOpacity, surfaceOpacity]);

    const contentStyle = useAnimatedStyle(() => ({
        opacity: contentOpacity.value,
    }));

    const surfaceStyle = useAnimatedStyle(() => ({
        left: x.value,
        top: y.value,
        width: width.value,
        height: height.value,
        borderRadius: radius.value,
        opacity: surfaceOpacity.value,
    }));

    return (
        <View style={[styles.root, { backgroundColor: color }]}>
            <Animated.View style={[styles.content, contentStyle]}>{children}</Animated.View>
            {!surfaceGone ? (
                <Animated.View
                    pointerEvents="none"
                    style={[styles.surface, { backgroundColor: color }, surfaceStyle]}
                />
            ) : null}
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
    },
    content: {
        flex: 1,
    },
    surface: {
        position: 'absolute',
        zIndex: 20,
    },
});
