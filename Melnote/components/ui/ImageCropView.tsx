import React from 'react';
import {
    ActivityIndicator,
    Image,
    Platform,
    ScrollView,
    StyleSheet,
    View,
    type LayoutChangeEvent,
    type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
    Easing,
    runOnJS,
    useAnimatedStyle,
    useSharedValue,
    withTiming,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { ThemedText } from './ThemedText';
import { Icon } from './Icon';
import { ScalePressable } from './ScalePressable';
import { Typography } from '../../constants/Typography';
import { useAppTheme } from '../../hooks/useAppTheme';
import type { MediaCropRect } from '../../utils/media';

interface ImageCropViewProps {
    uri: string;
    busy?: boolean;
    onCancel: () => void;
    onConfirm: (rect: MediaCropRect) => void;
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const CANVAS_PADDING = 26;
const MIN_SIZE = 56;
const HANDLE_HIT = 44;
const HANDLE_LENGTH = 18;
const HANDLE_THICKNESS = 2.5;
const GRID_EASE = Easing.out(Easing.quad);
const REFRAME = { duration: 180, easing: GRID_EASE };

const RATIOS: { label: string; value: number | null }[] = [
    { label: 'Free', value: null },
    { label: '1:1', value: 1 },
    { label: '4:5', value: 4 / 5 },
    { label: '3:2', value: 3 / 2 },
    { label: '16:9', value: 16 / 9 },
];

function clamp(value: number, min: number, max: number) {
    'worklet';
    return Math.min(max, Math.max(min, value));
}

/**
 * Full-screen crop canvas.
 *
 * The image is contain-fitted and its display rect is fixed for the session.
 * All crop geometry lives in shared values so dragging the frame and its
 * corners never re-renders React; only the pixel rect is computed on Done.
 */
export function ImageCropView({ uri, busy = false, onCancel, onConfirm }: ImageCropViewProps) {
    const insets = useSafeAreaInsets();
    const { colors, hapticsEnabled } = useAppTheme();

    const [canvas, setCanvas] = React.useState<{ width: number; height: number } | null>(null);
    const [natural, setNatural] = React.useState<{ width: number; height: number } | null>(null);
    const [failed, setFailed] = React.useState(false);
    const [ratio, setRatio] = React.useState<number | null>(null);
    const [applying, setApplying] = React.useState(false);

    // Frame geometry, in canvas coordinates.
    const fx = useSharedValue(0);
    const fy = useSharedValue(0);
    const fw = useSharedValue(0);
    const fh = useSharedValue(0);
    const grid = useSharedValue(0);

    // Gesture anchors.
    const startX = useSharedValue(0);
    const startY = useSharedValue(0);
    const startW = useSharedValue(0);
    const startH = useSharedValue(0);

    React.useEffect(() => {
        if (!busy) setApplying(false);
    }, [busy]);

    const tick = React.useCallback(() => {
        if (hapticsEnabled && Platform.OS !== 'web') {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
    }, [hapticsEnabled]);

    React.useEffect(() => {
        let alive = true;
        Image.getSize(
            uri,
            (width, height) => {
                if (alive && width > 0 && height > 0) setNatural({ width, height });
            },
            () => {
                if (alive) setFailed(true);
            }
        );
        return () => {
            alive = false;
        };
    }, [uri]);

    const imageRect = React.useMemo(() => {
        if (!canvas || !natural) return null;
        const availableW = Math.max(1, canvas.width - CANVAS_PADDING * 2);
        const availableH = Math.max(1, canvas.height - CANVAS_PADDING * 2);
        const fit = Math.min(availableW / natural.width, availableH / natural.height);
        const width = natural.width * fit;
        const height = natural.height * fit;
        return {
            x: (canvas.width - width) / 2,
            y: (canvas.height - height) / 2,
            width,
            height,
        };
    }, [canvas, natural]);

    // Start with the frame on the whole image whenever the display rect lands.
    React.useLayoutEffect(() => {
        if (!imageRect) return;
        fx.value = imageRect.x;
        fy.value = imageRect.y;
        fw.value = imageRect.width;
        fh.value = imageRect.height;
    }, [imageRect, fx, fy, fw, fh]);

    const imgX = imageRect?.x ?? 0;
    const imgY = imageRect?.y ?? 0;
    const imgW = imageRect?.width ?? 1;
    const imgH = imageRect?.height ?? 1;

    const bodyGesture = Gesture.Pan()
        .onBegin(() => {
            grid.value = withTiming(1, { duration: 120 });
            startX.value = fx.value;
            startY.value = fy.value;
        })
        .onUpdate((event) => {
            fx.value = clamp(startX.value + event.translationX, imgX, imgX + imgW - fw.value);
            fy.value = clamp(startY.value + event.translationY, imgY, imgY + imgH - fh.value);
        })
        .onFinalize(() => {
            grid.value = withTiming(0, { duration: 180 });
        });

    const cornerGesture = (corner: Corner) =>
        Gesture.Pan()
            .onBegin(() => {
                grid.value = withTiming(1, { duration: 120 });
                startX.value = fx.value;
                startY.value = fy.value;
                startW.value = fw.value;
                startH.value = fh.value;
                runOnJS(tick)();
            })
            .onUpdate((event) => {
                const left = corner === 'tl' || corner === 'bl';
                const top = corner === 'tl' || corner === 'tr';

                // The opposite corner stays put while this one follows the finger.
                const fixedX = left ? startX.value + startW.value : startX.value;
                const fixedY = top ? startY.value + startH.value : startY.value;
                const cornerX = (left ? startX.value : startX.value + startW.value) + event.translationX;
                const cornerY = (top ? startY.value : startY.value + startH.value) + event.translationY;

                const maxW = left ? fixedX - imgX : imgX + imgW - fixedX;
                const maxH = top ? fixedY - imgY : imgY + imgH - fixedY;

                let w = Math.abs(cornerX - fixedX);
                let h = Math.abs(cornerY - fixedY);

                if (ratio != null) {
                    if (w / h > ratio) h = w / ratio;
                    else w = h * ratio;
                    w = clamp(w, MIN_SIZE, maxW);
                    h = w / ratio;
                    if (h > maxH) {
                        h = maxH;
                        w = h * ratio;
                    }
                } else {
                    w = clamp(w, MIN_SIZE, maxW);
                    h = clamp(h, MIN_SIZE, maxH);
                }

                fw.value = w;
                fh.value = h;
                fx.value = left ? fixedX - w : fixedX;
                fy.value = top ? fixedY - h : fixedY;
            })
            .onFinalize(() => {
                grid.value = withTiming(0, { duration: 180 });
            });

    const frameStyle = useAnimatedStyle(() => ({
        left: fx.value,
        top: fy.value,
        width: fw.value,
        height: fh.value,
    }));

    const topMaskStyle = useAnimatedStyle(() => ({ height: fy.value }));
    const bottomMaskStyle = useAnimatedStyle(() => ({ top: fy.value + fh.value }));
    const leftMaskStyle = useAnimatedStyle(() => ({
        top: fy.value,
        height: fh.value,
        width: fx.value,
    }));
    const rightMaskStyle = useAnimatedStyle(() => ({
        top: fy.value,
        height: fh.value,
        left: fx.value + fw.value,
    }));
    const gridStyle = useAnimatedStyle(() => ({ opacity: grid.value }));

    // Corner handles live in the canvas rather than inside the frame: half of a
    // 44px touch target would otherwise fall outside its parent on Android and
    // never receive the gesture.
    const tlStyle = useAnimatedStyle<ViewStyle>(() => ({
        left: fx.value - HANDLE_HIT / 2,
        top: fy.value - HANDLE_HIT / 2,
    }));
    const trStyle = useAnimatedStyle<ViewStyle>(() => ({
        left: fx.value + fw.value - HANDLE_HIT / 2,
        top: fy.value - HANDLE_HIT / 2,
    }));
    const blStyle = useAnimatedStyle<ViewStyle>(() => ({
        left: fx.value - HANDLE_HIT / 2,
        top: fy.value + fh.value - HANDLE_HIT / 2,
    }));
    const brStyle = useAnimatedStyle<ViewStyle>(() => ({
        left: fx.value + fw.value - HANDLE_HIT / 2,
        top: fy.value + fh.value - HANDLE_HIT / 2,
    }));

    const chooseRatio = (value: number | null) => {
        if (busy || applying) return;
        tick();
        setRatio(value);
        if (value == null || !imageRect) return;

        const centerX = fx.value + fw.value / 2;
        const centerY = fy.value + fh.value / 2;

        // Keep the smaller dimension of the current frame and fit the ratio
        // inside it, so picking an aspect never balloons the frame.
        let width = Math.min(fw.value, fh.value * value);
        let height = width / value;
        if (width < MIN_SIZE) {
            width = MIN_SIZE;
            height = width / value;
        }
        if (height < MIN_SIZE) {
            height = MIN_SIZE;
            width = height * value;
        }
        if (width > imageRect.width) {
            width = imageRect.width;
            height = width / value;
        }
        if (height > imageRect.height) {
            height = imageRect.height;
            width = height * value;
        }

        const x = clamp(centerX - width / 2, imageRect.x, imageRect.x + imageRect.width - width);
        const y = clamp(centerY - height / 2, imageRect.y, imageRect.y + imageRect.height - height);

        fx.value = withTiming(x, REFRAME);
        fy.value = withTiming(y, REFRAME);
        fw.value = withTiming(width, REFRAME);
        fh.value = withTiming(height, REFRAME);
    };

    const cancel = () => {
        if (busy || applying) return;
        onCancel();
    };

    const confirm = () => {
        if (busy || applying || !imageRect || !natural) return;

        // Display coordinates -> source pixels of the working image.
        const scale = natural.width / imageRect.width;
        const originX = clamp(Math.round((fx.value - imageRect.x) * scale), 0, natural.width - 1);
        const originY = clamp(Math.round((fy.value - imageRect.y) * scale), 0, natural.height - 1);
        const width = clamp(Math.round(fw.value * scale), 1, natural.width - originX);
        const height = clamp(Math.round(fh.value * scale), 1, natural.height - originY);

        // The frame still covers the whole bitmap: nothing to crop, just leave
        // the view instead of re-encoding an identical image.
        if (
            originX === 0 &&
            originY === 0 &&
            width === natural.width &&
            height === natural.height
        ) {
            onCancel();
            return;
        }

        setApplying(true);
        tick();
        onConfirm({ originX, originY, width, height });
    };

    const onCanvasLayout = (event: LayoutChangeEvent) => {
        const { width, height } = event.nativeEvent.layout;
        if (width <= 0 || height <= 0) return;
        setCanvas(prev =>
            prev && prev.width === width && prev.height === height ? prev : { width, height }
        );
    };

    // Canvas-level corner handles: half of a 44px touch target would otherwise
    // fall outside its parent on Android and never receive the gesture.
    const corners: { key: Corner; style: typeof tlStyle }[] = [
        { key: 'tl', style: tlStyle },
        { key: 'tr', style: trStyle },
        { key: 'bl', style: blStyle },
        { key: 'br', style: brStyle },
    ];

    const blocked = busy || applying;
    const ready = imageRect !== null;

    return (
        <GestureHandlerRootView style={styles.root}>
            <View style={[styles.root, { paddingTop: insets.top + 10 }]}>
                <View style={styles.header}>
                    <View style={styles.headerSlot}>
                        <ScalePressable
                            onPress={cancel}
                            style={[styles.headerButton, { backgroundColor: colors.surface }]}
                            innerStyle={{ borderRadius: 20 }}
                            accessibilityLabel="Cancel crop"
                        >
                            <Icon name="close_line" size={20} color={colors.text} />
                        </ScalePressable>
                    </View>
                    <ThemedText style={styles.headerTitle}>Crop</ThemedText>
                    <View style={[styles.headerSlot, styles.headerSlotRight]}>
                        <ScalePressable
                            onPress={confirm}
                            disabled={!ready}
                            haptic={false}
                            style={[
                                styles.doneButton,
                                { backgroundColor: colors.tint, opacity: ready ? 1 : 0.4 },
                            ]}
                            innerStyle={{ borderRadius: 20 }}
                            accessibilityLabel="Apply crop"
                        >
                            <ThemedText style={[styles.doneText, { color: colors.tintContrast }]}>
                                Done
                            </ThemedText>
                        </ScalePressable>
                    </View>
                </View>

                <View style={styles.canvas} onLayout={onCanvasLayout}>
                    {ready && imageRect && (
                        <>
                            <Image
                                source={{ uri }}
                                style={{
                                    position: 'absolute',
                                    left: imageRect.x,
                                    top: imageRect.y,
                                    width: imageRect.width,
                                    height: imageRect.height,
                                }}
                                resizeMode="stretch"
                            />

                            {/* Dim everything outside the crop frame. */}
                            <Animated.View
                                pointerEvents="none"
                                style={[styles.mask, styles.maskTop, topMaskStyle]}
                            />
                            <Animated.View
                                pointerEvents="none"
                                style={[styles.mask, styles.maskBottom, bottomMaskStyle]}
                            />
                            <Animated.View
                                pointerEvents="none"
                                style={[styles.mask, styles.maskLeft, leftMaskStyle]}
                            />
                            <Animated.View
                                pointerEvents="none"
                                style={[styles.mask, styles.maskRight, rightMaskStyle]}
                            />

                            <Animated.View style={[styles.frame, frameStyle]}>
                                <GestureDetector gesture={bodyGesture}>
                                    <Animated.View style={StyleSheet.absoluteFill} />
                                </GestureDetector>

                                <Animated.View
                                    pointerEvents="none"
                                    style={[StyleSheet.absoluteFill, gridStyle]}
                                >
                                    <View style={[styles.gridLine, styles.gridLineV, { left: '33.333%' }]} />
                                    <View style={[styles.gridLine, styles.gridLineV, { left: '66.666%' }]} />
                                    <View style={[styles.gridLine, styles.gridLineH, { top: '33.333%' }]} />
                                    <View style={[styles.gridLine, styles.gridLineH, { top: '66.666%' }]} />
                                </Animated.View>
                            </Animated.View>

                            {corners.map(({ key, style }) => (
                                <GestureDetector key={key} gesture={cornerGesture(key)}>
                                    <Animated.View style={[styles.handleHit, style]}>
                                        <View style={[styles.handleBracket, bracketStyle[key]]} />
                                    </Animated.View>
                                </GestureDetector>
                            ))}
                        </>
                    )}

                    {!ready && !failed && (
                        <View style={styles.centerState}>
                            <ActivityIndicator color="#ffffff" />
                        </View>
                    )}

                    {failed && (
                        <View style={styles.centerState}>
                            <ThemedText style={styles.failText}>
                                This image could not be opened.
                            </ThemedText>
                        </View>
                    )}
                </View>

                <View style={[styles.footer, { paddingBottom: insets.bottom + 18 }]}>
                    <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.ratioRow}
                    >
                        {RATIOS.map(option => {
                            const active = ratio === option.value;
                            return (
                                <ScalePressable
                                    key={option.label}
                                    onPress={() => chooseRatio(option.value)}
                                    haptic={false}
                                    style={[
                                        styles.ratioChip,
                                        { backgroundColor: active ? colors.tint : colors.surface },
                                    ]}
                                    innerStyle={{ borderRadius: 19 }}
                                    accessibilityLabel={`Crop aspect ${option.label}`}
                                >
                                    <ThemedText
                                        style={[
                                            styles.ratioText,
                                            { color: active ? colors.tintContrast : colors.text },
                                        ]}
                                    >
                                        {option.label}
                                    </ThemedText>
                                </ScalePressable>
                            );
                        })}
                    </ScrollView>
                </View>

                {blocked && (
                    <View style={styles.busy}>
                        <ActivityIndicator size="large" color={colors.tint} />
                    </View>
                )}
            </View>
        </GestureHandlerRootView>
    );
}

const bracketStyle: Record<Corner, ViewStyle> = {
    tl: { borderLeftWidth: HANDLE_THICKNESS, borderTopWidth: HANDLE_THICKNESS, borderTopLeftRadius: 4 },
    tr: { borderRightWidth: HANDLE_THICKNESS, borderTopWidth: HANDLE_THICKNESS, borderTopRightRadius: 4 },
    bl: { borderLeftWidth: HANDLE_THICKNESS, borderBottomWidth: HANDLE_THICKNESS, borderBottomLeftRadius: 4 },
    br: { borderRightWidth: HANDLE_THICKNESS, borderBottomWidth: HANDLE_THICKNESS, borderBottomRightRadius: 4 },
};

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#000000',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 10,
    },
    headerSlot: {
        width: 80,
        alignItems: 'flex-start',
    },
    headerSlotRight: {
        alignItems: 'flex-end',
    },
    headerButton: {
        width: 40,
        height: 40,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        color: '#ffffff',
        fontSize: 17,
        fontFamily: Typography.fontFamily.bold,
    },
    doneButton: {
        height: 40,
        paddingHorizontal: 20,
        borderRadius: 20,
        alignItems: 'center',
        justifyContent: 'center',
    },
    doneText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.semibold,
    },
    canvas: {
        flex: 1,
    },
    mask: {
        position: 'absolute',
        backgroundColor: 'rgba(0, 0, 0, 0.62)',
    },
    maskTop: {
        left: 0,
        right: 0,
        top: 0,
    },
    maskBottom: {
        left: 0,
        right: 0,
        bottom: 0,
    },
    maskLeft: {
        left: 0,
    },
    maskRight: {
        right: 0,
    },
    frame: {
        position: 'absolute',
        borderWidth: 1.5,
        borderColor: 'rgba(255, 255, 255, 0.9)',
    },
    gridLine: {
        position: 'absolute',
        backgroundColor: 'rgba(255, 255, 255, 0.4)',
    },
    gridLineV: {
        top: 0,
        bottom: 0,
        width: StyleSheet.hairlineWidth,
    },
    gridLineH: {
        left: 0,
        right: 0,
        height: StyleSheet.hairlineWidth,
    },
    handleHit: {
        position: 'absolute',
        width: HANDLE_HIT,
        height: HANDLE_HIT,
        alignItems: 'center',
        justifyContent: 'center',
    },
    handleBracket: {
        width: HANDLE_LENGTH,
        height: HANDLE_LENGTH,
        borderColor: '#ffffff',
    },
    centerState: {
        ...StyleSheet.absoluteFill,
        alignItems: 'center',
        justifyContent: 'center',
    },
    failText: {
        color: 'rgba(255, 255, 255, 0.75)',
        fontSize: 14,
        textAlign: 'center',
        paddingHorizontal: 32,
    },
    footer: {
        paddingHorizontal: 16,
        paddingTop: 14,
    },
    ratioRow: {
        flexGrow: 1,
        justifyContent: 'center',
        gap: 8,
    },
    ratioChip: {
        height: 38,
        paddingHorizontal: 16,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 19,
    },
    ratioText: {
        fontSize: 13,
        fontFamily: Typography.fontFamily.semibold,
    },
    busy: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        alignItems: 'center',
        justifyContent: 'center',
    },
});
