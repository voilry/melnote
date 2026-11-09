import React, { useEffect, useRef, useCallback } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
    Easing,
    useAnimatedStyle,
    useReducedMotion,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';

interface RemoveEvent {
    preventDefault: () => void;
    data: { action: { type: string } };
}

interface ScreenMotionProps {
    children: React.ReactNode;
    navigation: {
        addListener: (
            event: 'beforeRemove' | 'focus' | 'blur',
            listener: (e: any) => void
        ) => () => void;
        dispatch: (action: any) => void;
    };
    enabled?: boolean;
    isTabRoot?: boolean;
}

const TRAVEL_RATIO = 0.06;
const ENTER_DURATION = 300;
const ENTER_FADE_DURATION = 240;

const EXIT_SCALE_TARGET = 0.94;
const EXIT_DURATION = 110;
const EXIT_FADE_DURATION = 95;
const EXIT_DISPATCH_DELAY = 50;

const RE_ARRIVAL_FADE_DURATION = 60;

const EASING_ENTER = Easing.out(Easing.cubic);
const EASING_EXIT = Easing.in(Easing.quad);

export function ScreenMotion({
    children,
    navigation,
    enabled = true,
    isTabRoot = false,
}: ScreenMotionProps) {
    const { height } = useWindowDimensions();
    const reduceMotion = useReducedMotion();
    const animate = enabled && !reduceMotion;
    const enterOffset = Math.round(height * TRAVEL_RATIO);

    const translateY = useSharedValue(animate && !isTabRoot ? enterOffset : 0);
    const scale = useSharedValue(1);
    const opacity = useSharedValue(animate && !isTabRoot ? 0 : 1);

    const leavingRef = useRef(false);
    const bypassRef = useRef(false);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const hasBeenBlurred = useRef(false);

    // Enter Pop-In
    useEffect(() => {
        if (!animate || isTabRoot) {
            translateY.value = 0;
            scale.value = 1;
            opacity.value = 1;
            return;
        }

        scale.value = 1;
        translateY.value = withTiming(0, { duration: ENTER_DURATION, easing: EASING_ENTER });
        opacity.value = withTiming(1, { duration: ENTER_FADE_DURATION, easing: EASING_ENTER });
    }, [animate, isTabRoot, translateY, scale, opacity]);

    // Re-arrival: when this screen regains focus after a child screen pops
    useEffect(() => {
        if (!animate) return;

        const unsubscribeBlur = navigation.addListener('blur', () => {
            hasBeenBlurred.current = true;
            opacity.value = 0;
        });

        const unsubscribeFocus = navigation.addListener('focus', () => {
            if (hasBeenBlurred.current) {
                translateY.value = 0;
                scale.value = 1;
                opacity.value = withTiming(1, { duration: RE_ARRIVAL_FADE_DURATION, easing: EASING_ENTER });
            }
        });

        return () => {
            unsubscribeBlur();
            unsubscribeFocus();
        };
    }, [animate, navigation, translateY, scale, opacity]);

    const dispatchExit = useCallback((action: any) => {
        if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
        bypassRef.current = true;
        leavingRef.current = false;
        navigation.dispatch(action);
    }, [navigation]);

    // Exit Micro Pop-Out
    useEffect(() => {
        if (!animate || isTabRoot) return;

        const unsubscribe = navigation.addListener('beforeRemove', (event: RemoveEvent) => {
            if (bypassRef.current) return;

            const actionType = event.data.action.type;
            if (actionType !== 'POP' && actionType !== 'POP_TO_TOP' && actionType !== 'GO_BACK') return;
            if (leavingRef.current) return;

            event.preventDefault();
            leavingRef.current = true;

            scale.value = withTiming(EXIT_SCALE_TARGET, { duration: EXIT_DURATION, easing: EASING_EXIT });
            opacity.value = withTiming(0, { duration: EXIT_FADE_DURATION, easing: EASING_EXIT });

            timerRef.current = setTimeout(() => {
                dispatchExit(event.data.action);
            }, EXIT_DISPATCH_DELAY);
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
    }, [animate, isTabRoot, navigation, scale, opacity, dispatchExit]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [
            { translateY: translateY.value },
            { scale: scale.value },
        ],
        opacity: opacity.value,
    }));

    if (!enabled) return <>{children}</>;

    return <Animated.View style={[styles.fill, animatedStyle]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
    fill: { flex: 1 },
});
