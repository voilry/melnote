import React from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
} from 'react-native-reanimated';
import { X } from './Icon';

export interface ViewerImage {
    uri: string;
    caption?: string;
}

interface ImageViewerProps {
    visible: boolean;
    images: ViewerImage[];
    initialIndex?: number;
    onClose: () => void;
}

const MAX_SCALE = 4;
const DOUBLE_TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
    'worklet';
    return Math.min(max, Math.max(min, value));
}

interface ZoomablePageProps {
    uri: string;
    width: number;
    height: number;
    active: boolean;
    onZoomChange: (zoomed: boolean) => void;
}

/**
 * One full-screen image with its own zoom system. Enabled only while the page
 * is the active one; the parent pager owns horizontal swipes at scale 1.
 */
function ZoomablePage({ uri, width, height, active, onZoomChange }: ZoomablePageProps) {
    const scale = useSharedValue(1);
    const translateX = useSharedValue(0);
    const translateY = useSharedValue(0);
    const startScale = useSharedValue(1);
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const [zoomed, setZoomed] = React.useState(false);

    // Fit bounds: zooming a portrait photo on a portrait screen must not let it
    // be panned into the letterbox. Measure the bitmap so clamping uses the
    // DISPLAYED size (contain), not the full screen.
    const [natural, setNatural] = React.useState<{ w: number; h: number } | null>(null);
    React.useEffect(() => {
        let alive = true;
        Image.getSize(
            uri,
            (w, h) => {
                if (alive && w > 0 && h > 0) setNatural({ w, h });
            },
            () => { }
        );
        return () => { alive = false; };
    }, [uri]);

    const fit = natural ? Math.min(width / natural.w, height / natural.h) : 1;
    const baseW = natural ? Math.min(width, natural.w * fit) : width;
    const baseH = natural ? Math.min(height, natural.h * fit) : height;

    const reportZoom = React.useCallback((value: boolean) => {
        setZoomed(value);
        onZoomChange(value);
    }, [onZoomChange]);

    const reset = React.useCallback(() => {
        scale.value = withTiming(1, { duration: 180 });
        translateX.value = withTiming(0, { duration: 180 });
        translateY.value = withTiming(0, { duration: 180 });
    }, [scale, translateX, translateY]);

    React.useEffect(() => {
        if (!active && zoomed) {
            reset();
            reportZoom(false);
        }
    }, [active, zoomed, reset, reportZoom]);

    const pinch = Gesture.Pinch()
        .onStart(() => {
            startScale.value = scale.value;
        })
        .onUpdate(event => {
            scale.value = clamp(startScale.value * event.scale, 1, MAX_SCALE);
        })
        .onEnd(() => {
            if (scale.value <= 1.02) {
                scale.value = withTiming(1, { duration: 160 });
                translateX.value = withTiming(0, { duration: 160 });
                translateY.value = withTiming(0, { duration: 160 });
                runOnJS(reportZoom)(false);
            } else {
                runOnJS(reportZoom)(true);
            }
        });

    const pan = Gesture.Pan()
        .maxPointers(1)
        .enabled(zoomed)
        .onStart(() => {
            startX.value = translateX.value;
            startY.value = translateY.value;
        })
        .onUpdate(event => {
            const maxX = (baseW * (scale.value - 1)) / 2;
            const maxY = (baseH * (scale.value - 1)) / 2;
            translateX.value = clamp(startX.value + event.translationX, -maxX, maxX);
            translateY.value = clamp(startY.value + event.translationY, -maxY, maxY);
        })
        .onEnd(() => {
            const maxX = (baseW * (scale.value - 1)) / 2;
            const maxY = (baseH * (scale.value - 1)) / 2;
            translateX.value = withSpring(clamp(translateX.value, -maxX, maxX), {
                damping: 24,
                stiffness: 260,
            });
            translateY.value = withSpring(clamp(translateY.value, -maxY, maxY), {
                damping: 24,
                stiffness: 260,
            });
        });

    const doubleTap = Gesture.Tap()
        .numberOfTaps(2)
        .onEnd(event => {
            if (scale.value > 1.01) {
                scale.value = withTiming(1, { duration: 200 });
                translateX.value = withTiming(0, { duration: 200 });
                translateY.value = withTiming(0, { duration: 200 });
                runOnJS(reportZoom)(false);
                return;
            }

            const target = DOUBLE_TAP_SCALE;
            const pointX = event.x - width / 2;
            const pointY = event.y - height / 2;
            const maxX = (baseW * (target - 1)) / 2;
            const maxY = (baseH * (target - 1)) / 2;

            scale.value = withTiming(target, { duration: 220 });
            translateX.value = withTiming(
                clamp(-pointX * (target - 1), -maxX, maxX),
                { duration: 220 }
            );
            translateY.value = withTiming(
                clamp(-pointY * (target - 1), -maxY, maxY),
                { duration: 220 }
            );
            runOnJS(reportZoom)(true);
        });

    const gesture = Gesture.Simultaneous(pinch, pan, doubleTap);

    const imageStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: translateX.value },
            { translateY: translateY.value },
            { scale: scale.value },
        ],
    }));

    return (
        <View style={[styles.page, { width, height }]}>
            <GestureDetector gesture={gesture}>
                <Animated.View style={[styles.pageInner, imageStyle]}>
                    <Animated.Image
                        source={{ uri }}
                        style={{ width, height }}
                        resizeMode="contain"
                    />
                </Animated.View>
            </GestureDetector>
        </View>
    );
}

/**
 * Full-screen image viewer.
 *
 * - pinch + double-tap zoom, pan while zoomed
 * - swipe horizontally between images at scale 1
 * - swipe down to dismiss (with the backdrop fading as it moves)
 */
export function ImageViewer({ visible, images, initialIndex = 0, onClose }: ImageViewerProps) {
    const insets = useSafeAreaInsets();
    const { width, height } = useWindowDimensions();
    const count = images.length;
    const safeInitial = Math.min(Math.max(initialIndex, 0), Math.max(0, count - 1));

    const [active, setActive] = React.useState(safeInitial);
    const [zoomed, setZoomed] = React.useState(false);

    const index = useSharedValue(safeInitial);
    const dragX = useSharedValue(0);
    const dragY = useSharedValue(0);

    React.useEffect(() => {
        if (!visible) return;
        index.value = safeInitial;
        dragX.value = 0;
        dragY.value = 0;
        setActive(safeInitial);
        setZoomed(false);
    }, [visible, safeInitial, index, dragX, dragY]);

    const close = React.useCallback(() => onClose(), [onClose]);

    const pagerGesture = Gesture.Pan()
        .maxPointers(1)
        .enabled(!zoomed)
        .onUpdate(event => {
            if (Math.abs(event.translationX) >= Math.abs(event.translationY)) {
                dragX.value = event.translationX;
                dragY.value = 0;
            } else {
                dragY.value = event.translationY;
                dragX.value = 0;
            }
        })
        .onEnd(event => {
            const dx = dragX.value;
            const dy = dragY.value;

            // Swipe-down dismiss (dragging up is not a dismiss gesture).
            if (dy > 110 || (dy > 45 && event.velocityY > 900)) {
                dragY.value = withTiming(height, { duration: 180 }, finished => {
                    if (finished) runOnJS(close)();
                });
                dragX.value = withTiming(0, { duration: 180 });
                return;
            }

            if (count > 1 && (Math.abs(dx) > width * 0.22 || Math.abs(event.velocityX) > 700)) {
                const next = clamp(active + (dx < 0 ? 1 : -1), 0, count - 1);
                index.value = withTiming(next, { duration: 220 });
                dragX.value = withTiming(0, { duration: 220 });
                runOnJS(setActive)(next);
                return;
            }

            dragX.value = withSpring(0, { damping: 24, stiffness: 260 });
            dragY.value = withSpring(0, { damping: 24, stiffness: 260 });
        });

    const pagerStyle = useAnimatedStyle(() => ({
        transform: [
            { translateX: -index.value * width + dragX.value },
            { translateY: dragY.value },
        ],
        opacity: 1 - Math.min(0.35, Math.abs(dragY.value) / height),
    }));

    const backdropStyle = useAnimatedStyle(() => ({
        opacity: 1 - Math.min(0.65, Math.abs(dragY.value) / height),
    }));

    const descriptor = images[active];

    return (
        <Modal
            visible={visible}
            transparent
            animationType="fade"
            statusBarTranslucent
            presentationStyle="overFullScreen"
            onRequestClose={close}
        >
            <GestureHandlerRootView style={styles.root}>
                <View style={styles.root}>
                    <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />

                    {visible && count > 0 ? (
                        <GestureDetector gesture={pagerGesture}>
                            <Animated.View
                                style={[
                                    styles.pager,
                                    { width: width * count, height },
                                    pagerStyle,
                                ]}
                            >
                                {images.map((image, page) => (
                                    <ZoomablePage
                                        key={`${image.uri}-${page}`}
                                        uri={image.uri}
                                        width={width}
                                        height={height}
                                        active={page === active}
                                        onZoomChange={value => {
                                            if (page === active) setZoomed(value);
                                        }}
                                    />
                                ))}
                            </Animated.View>
                        </GestureDetector>
                    ) : null}

                    <Pressable
                        onPress={close}
                        hitSlop={12}
                        style={[styles.close, { top: insets.top + 12 }]}
                        accessibilityRole="button"
                        accessibilityLabel="Close image"
                    >
                        <X size={20} color="#FFFFFF" />
                    </Pressable>

                    {count > 1 ? (
                        <View style={[styles.counter, { top: insets.top + 20 }]} pointerEvents="none">
                            <Text style={styles.counterText}>
                                {active + 1} / {count}
                            </Text>
                        </View>
                    ) : null}

                    {descriptor?.caption ? (
                        <View
                            style={[styles.captionWrap, { paddingBottom: insets.bottom + 24 }]}
                            pointerEvents="none"
                        >
                            <Text style={styles.caption} numberOfLines={3}>
                                {descriptor.caption}
                            </Text>
                        </View>
                    ) : null}
                </View>
            </GestureHandlerRootView>
        </Modal>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: 'transparent',
    },
    backdrop: {
        backgroundColor: '#000000',
    },
    pager: {
        flexDirection: 'row',
        alignItems: 'center',
    },
    page: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    pageInner: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    close: {
        position: 'absolute',
        right: 16,
        width: 38,
        height: 38,
        borderRadius: 19,
        backgroundColor: 'rgba(255, 255, 255, 0.16)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    counter: {
        position: 'absolute',
        alignSelf: 'center',
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 12,
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    counterText: {
        color: 'rgba(255, 255, 255, 0.85)',
        fontSize: 12,
        fontWeight: '600',
    },
    captionWrap: {
        position: 'absolute',
        left: 24,
        right: 24,
        bottom: 0,
        alignItems: 'center',
    },
    caption: {
        color: 'rgba(255, 255, 255, 0.9)',
        fontSize: 14,
        lineHeight: 20,
        textAlign: 'center',
    },
});
