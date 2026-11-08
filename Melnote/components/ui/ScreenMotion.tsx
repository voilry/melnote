import React, { useEffect, useRef } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withDelay,
    withTiming,
} from 'react-native-reanimated';

interface RemoveEvent {
    preventDefault: () => void;
    data: { action: { type: string } };
}

interface ScreenMotionProps {
    children: React.ReactNode;
    /** The screen's own navigation object, used to animate the pop. */
    navigation: {
        addListener: (
            event: 'beforeRemove',
            listener: (e: RemoveEvent) => void
        ) => () => void;
        dispatch: (action: any) => void;
    };
    enabled?: boolean;
}

/** Travel distance, matching rns_fade_from_bottom.xml (8% of the window). */
const TRAVEL_RATIO = 0.08;

/** Enter: rns_fade_from_bottom.xml translate, 350ms decelerate quint. */
const ENTER_DURATION = 350;

/** Enter: rns_fade_from_bottom.xml alpha, 210ms decelerate quint. */
const ENTER_FADE_DURATION = 210;

/** Exit: translate 0 -> +8%, 250ms in the native preset; 180ms here. */
const EXIT_DURATION = 180;

/**
 * Exit fade. The native preset holds the alpha for 100ms before fading, which
 * leaves the first tenth of a second with nothing moving - that is what read as
 * a lag. Starting at 0 gives the eye something to follow from the first frame,
 * and the fade now spans the whole exit so the screen is fully gone exactly when
 * the travel ends.
 */
const EXIT_FADE_DELAY = 0;
const EXIT_FADE_DURATION = EXIT_DURATION;

/**
 * How early the pop is committed, in ms, before the fade finishes.
 *
 * When the fade hits 0 the screen is invisible, but the previous screen is not
 * on the display yet: the dispatch has to travel JS -> React -> native fragment
 * transaction -> next frame. Dispatching at the end of the fade therefore adds
 * that latency on top, and the result is a beat of bare background.
 *
 * Starting the dispatch this much before the end means the previous screen is
 * attached at roughly the same moment the outgoing one becomes transparent. If
 * the blank still shows, raise this; if the outgoing screen vanishes while still
 * faintly visible, lower it.
 */
const EXIT_DISPATCH_LEAD = 40;

/**
 * `fade_from_bottom`'s motion on enter AND back: the screen rises into place
 * while fading in, and falls away while fading out.
 *
 * Geometry and timings are copied from the library, so this is the same motion
 * the native preset gave (the one that read as a rise rather than a slide):
 *
 *   enter: translateY 8% -> 0, decelerate quint, 350ms
 *          alpha      0  -> 1, decelerate quint, 210ms
 *   exit:  translateY 0 -> +8%, accelerate quint, 180ms (native is 250ms)
 *          alpha      1  -> 0, linear, 180ms (native is +100ms delay, 150ms)
 *
 * The native preset is not used directly because it drops a frame of screen
 * content at the transition boundaries on Android Fabric. `animation: 'none'`
 * turns that native fragment animation off, and this component plays the same
 * motion instead.
 *
 * The opacity is what keeps the exit from reading as a cut: the screen fades
 * out as it travels, so its clipped lower edge is never visible before the
 * navigation commits.
 *
 * The pop has to be driven manually because `animation: 'none'` removes the
 * outgoing screen in 20ms, so `beforeRemove` is intercepted for pop/back actions
 * and the navigation is dispatched once the motion is nearly finished.
 */
export function ScreenMotion({ children, navigation, enabled = true }: ScreenMotionProps) {
    const { height } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const animate = enabled && !reduceMotion;
    const offset = Math.round(height * TRAVEL_RATIO);

    const translateY = useSharedValue(animate ? offset : 0);
    const opacity = useSharedValue(animate ? 0 : 1);

    const leavingRef = useRef(false);
    const bypassRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Enter
    useEffect(() => {
        if (!animate) {
            translateY.value = 0;
            opacity.value = 1;
            return;
        }

        translateY.value = withTiming(0, {
            duration: ENTER_DURATION,
            easing: Easing.out(Easing.poly(5)),
        });
        opacity.value = withTiming(1, {
            duration: ENTER_FADE_DURATION,
            easing: Easing.out(Easing.poly(5)),
        });
    }, [animate, translateY, opacity]);

    // Exit (pop)
    useEffect(() => {
        if (!animate) return;

        const unsubscribe = navigation.addListener('beforeRemove', (event) => {
            // Dispatching the intercepted action below fires this listener
            // again; without this guard the screen would animate forever.
            if (bypassRef.current) return;

            const actionType = event.data.action.type;

            // Only pops animate. Reset / replace / navigate must go straight
            // through, otherwise things like sign-out would sit still.
            if (actionType !== 'POP' && actionType !== 'POP_TO_TOP' && actionType !== 'GO_BACK') {
                return;
            }

            // A second back press while the first one is still playing should
            // not queue another animation - let it through immediately.
            if (leavingRef.current) return;

            event.preventDefault();
            leavingRef.current = true;

            translateY.value = withTiming(offset, {
                duration: EXIT_DURATION,
                easing: Easing.in(Easing.poly(5)),
            });
            opacity.value = withDelay(
                EXIT_FADE_DELAY,
                withTiming(0, { duration: EXIT_FADE_DURATION, easing: Easing.linear })
            );

            timerRef.current = setTimeout(() => {
                timerRef.current = null;
                bypassRef.current = true;
                leavingRef.current = false;
                navigation.dispatch(event.data.action);
            }, EXIT_DURATION - EXIT_DISPATCH_LEAD);
        });

        return () => {
            unsubscribe();
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            leavingRef.current = false;
            bypassRef.current = false;
        };
    }, [animate, navigation, offset, translateY, opacity]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
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
