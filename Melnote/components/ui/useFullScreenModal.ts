import { useEffect, useState } from 'react';
import { useWindowDimensions } from 'react-native';
import { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

const ENTER_MS = 300;
const EXIT_MS = 240;
const EASE = Easing.bezier(0.2, 0, 0, 1);

/**
 * Android's native Modal tears down its children the instant `visible` flips
 * to false (RN's Libraries/Modal/Modal.js -> `_shouldShowModal` returns false,
 * so `render()` returns null). The window then animates away with nothing left
 * inside it, so an opaque modal slides out as a blank white screen instead of
 * the screen the user was looking at.
 *
 * This keeps the modal mounted and slides the content ourselves, so what
 * animates away is the real screen. Pair it with `transparent` on the <Modal>
 * so React Native's default white container doesn't sit behind the content
 * while it slides.
 */
export function useFullScreenModal(visible: boolean) {
    const { height } = useWindowDimensions();
    const [mounted, setMounted] = useState(visible);
    const translateY = useSharedValue(visible ? height : 0);

    // Close: slide the content away, then drop the native modal.
    useEffect(() => {
        if (visible) {
            if (!mounted) {
                translateY.value = height;
                setMounted(true);
            }
            return;
        }

        if (!mounted) return;

        translateY.value = withTiming(
            height,
            { duration: EXIT_MS, easing: EASE },
            (finished) => {
                if (finished) runOnJS(setMounted)(false);
            }
        );
    }, [visible, mounted, height, translateY]);

    // Open: slide the content in.
    useEffect(() => {
        if (!mounted || !visible) return;
        translateY.value = withTiming(0, { duration: ENTER_MS, easing: EASE });
    }, [mounted, visible, height, translateY]);

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
    }));

    return { mounted, animatedStyle };
}
