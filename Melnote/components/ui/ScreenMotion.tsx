import React, { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

interface RemoveEvent {
    data: { action: { type: string } };
}

interface ScreenMotionProps {
    children: React.ReactNode;
    /**
     * The screen's own navigation object. Only listened to, never prevented -
     * the native transition still runs, this just moves the screen while it does.
     */
    navigation: {
        addListener: (
            event: 'beforeRemove',
            listener: (e: RemoveEvent) => void
        ) => () => void;
    };
    enabled?: boolean;
}

/** Travel distance, matching rns_fade_from_bottom.xml (8% of the window). */
const TRAVEL_RATIO = 0.08;

/** Enter: translate 8% -> 0, decelerate quint, 350ms. */
const ENTER_DURATION = 350;

/** Exit: translate 0 -> +8%, accelerate quint, 250ms. */
const EXIT_DURATION = 250;

/**
 * The vertical motion of `fade_from_bottom`, laid on top of the native `fade`.
 *
 * `fade` is the only native preset that gives a real crossfade without the
 * blink: both fragments animate their own alpha for 150ms, so a missed repaint
 * hides behind the fade. `fade_from_bottom` instead holds the outgoing screen
 * fully opaque and motionless for 350ms (`rns_no_animation_350`), and that
 * overlap is what drops the frame.
 *
 * What `fade` lacks is the movement, so that is all this component does:
 *
 *   enter: translateY 8% -> 0, decelerate quint, 350ms
 *   exit:  translateY 0 -> +8%, accelerate quint, 250ms
 *
 * No opacity here - the native fade owns that. Running both would double-fade.
 *
 * The exit is not intercepted. `beforeRemove` is observed only to start the
 * transform at the same moment the native fade-out begins, so the two run
 * together instead of one after the other. Nothing is prevented, so the stack
 * behaves exactly as it would without this component.
 */
export function ScreenMotion({ children, navigation, enabled = true }: ScreenMotionProps) {
    const { height } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const animate = enabled && !reduceMotion;
    const offset = Math.round(height * TRAVEL_RATIO);

    const translateY = useSharedValue(animate ? offset : 0);
    const leavingRef = useRef(false);

    // Enter
    useEffect(() => {
        if (!animate) {
            translateY.value = 0;
            return;
        }

        translateY.value = withTiming(0, {
            duration: ENTER_DURATION,
            easing: Easing.out(Easing.poly(5)),
        });
    }, [animate, translateY]);

    // Exit: ride the native fade, never block it
    useEffect(() => {
        if (!animate) return;

        const unsubscribe = navigation.addListener('beforeRemove', (event) => {
            const actionType = event.data.action.type;

            // Only pops move. Reset / replace / navigate leave the screen alone.
            if (actionType !== 'POP' && actionType !== 'POP_TO_TOP' && actionType !== 'GO_BACK') {
                return;
            }

            // A second back press must not restart the transform mid-flight.
            if (leavingRef.current) return;
            leavingRef.current = true;

            translateY.value = withTiming(offset, {
                duration: EXIT_DURATION,
                easing: Easing.in(Easing.poly(5)),
            });
        });

        return () => {
            unsubscribe();
            leavingRef.current = false;
        };
    }, [animate, navigation, offset, translateY]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    if (!enabled) {
        return <>{children}</>;
    }

    return <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
    fill: {
        flex: 1,
    },
});
