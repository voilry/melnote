import React from 'react';
import {
    ActivityIndicator,
    Alert,
    Image,
    KeyboardAvoidingView,
    Modal,
    Platform,
    Pressable,
    ScrollView,
    StyleSheet,
    TextInput,
    View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, SlideInDown, ZoomIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ThemedText } from './ThemedText';
import { Icon } from './Icon';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Typography';
import { deleteMediaRef, editMediaImage, isImageEditingAvailable, mediaRefFromUri, type MediaEditAction } from '../../utils/media';
import { PhotoSourceSheet } from './PhotoSourceSheet';
import { ScalePressable } from './ScalePressable';
import type { ImageAttrUpdate, ImageSelection } from '../../utils/imageSelection';

export type { ImageAttrUpdate, ImageSelection } from '../../utils/imageSelection';

export interface ImageActionTrigger {
    action: 'edit' | 'caption' | 'replace' | 'delete';
    timestamp: number;
}

interface ImageToolbarProps {
    selection: ImageSelection;
    triggerAction?: ImageActionTrigger | null;
    onActionHandled?: () => void;
    onUpdate: (update: ImageAttrUpdate) => void;
    onDelete: () => void;
    onDeselect: () => void;
    /** Fired while a nested sheet/modal is open, so screens can pin the state. */
    onSheetOpenChange?: (open: boolean) => void;
}

const CROP_PRESETS: { label: string; aspect: number | null }[] = [
    { label: 'Original', aspect: null },
    { label: 'Square 1:1', aspect: 1 },
    { label: '4:3', aspect: 4 / 3 },
    { label: '16:9', aspect: 16 / 9 },
];

// Matches the shared modal enter curves used across the app.
const EASE_ENTER = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const SHEET_ENTER = SlideInDown.duration(320).springify().damping(24).stiffness(240).mass(0.9);
const DIALOG_ENTER = ZoomIn.duration(280).springify().damping(22).stiffness(240).mass(0.85);

const CAPTION_MAX_LENGTH = 100;

/**
 * Contextual image modals manager.
 * Triggered by the floating menu pinned to the image in the WebView.
 */
export function ImageToolbar({
    selection,
    triggerAction,
    onActionHandled,
    onUpdate,
    onDelete,
    onDeselect,
    onSheetOpenChange,
}: ImageToolbarProps) {
    const { colors, hapticsEnabled } = useAppTheme();
    const insets = useSafeAreaInsets();

    const [captionOpen, setCaptionOpen] = React.useState(false);
    const [captionDraft, setCaptionDraft] = React.useState(selection.caption || '');
    const [editOpen, setEditOpen] = React.useState(false);
    const [replaceOpen, setReplaceOpen] = React.useState(false);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = React.useState(false);
    const [workingSrc, setWorkingSrc] = React.useState(selection.src);
    const [editing, setEditing] = React.useState(false);
    const [activeCropAspect, setActiveCropAspect] = React.useState<number | null>(null);

    const handledTriggerTimestampRef = React.useRef<number>(0);

    // Edit previews are temporary media files. Track the live one so a cancel,
    // an intermediate rotate/flip, or an unmount can delete it.
    const workingSrcRef = React.useRef(workingSrc);
    const selectionSrcRef = React.useRef(selection.src);
    const appliedSrcRef = React.useRef<string | null>(null);
    React.useEffect(() => { workingSrcRef.current = workingSrc; }, [workingSrc]);
    React.useEffect(() => { selectionSrcRef.current = selection.src; }, [selection.src]);

    const removeWorkingFile = React.useCallback((uri: string) => {
        if (!uri || uri === selectionSrcRef.current || uri === appliedSrcRef.current) return;
        const ref = mediaRefFromUri(uri);
        if (ref) deleteMediaRef(ref).catch(() => { });
    }, []);

    React.useEffect(() => () => {
        const current = workingSrcRef.current;
        if (current && current !== selectionSrcRef.current && current !== appliedSrcRef.current) {
            const ref = mediaRefFromUri(current);
            if (ref) deleteMediaRef(ref).catch(() => { });
        }
    }, []);

    const onSheetOpenChangeRef = React.useRef(onSheetOpenChange);
    onSheetOpenChangeRef.current = onSheetOpenChange;
    React.useEffect(() => () => {
        onSheetOpenChangeRef.current?.(false);
    }, []);

    const haptic = (style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) => {
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.impactAsync(style);
    };

    React.useEffect(() => {
        setWorkingSrc(selection.src);
    }, [selection.src, selection.pos]);

    const setSheet = (open: boolean) => onSheetOpenChange?.(open);

    const openCaption = React.useCallback(() => {
        haptic();
        // Older captions could exceed the new 100 character cap.
        setCaptionDraft((selection.caption || '').slice(0, CAPTION_MAX_LENGTH));
        setCaptionOpen(true);
        setSheet(true);
    }, [selection.caption]);

    const closeCaption = () => {
        setCaptionOpen(false);
        setSheet(false);
    };

    const saveCaption = () => {
        haptic();
        const trimmed = captionDraft.replace(/\s+/g, ' ').trim().slice(0, CAPTION_MAX_LENGTH);
        onUpdate({ title: trimmed });
        closeCaption();
    };

    const openEdit = React.useCallback(() => {
        if (!isImageEditingAvailable() || !mediaRefFromUri(selection.src)) {
            Alert.alert('Edit unavailable', 'Image editing requires a development build with native modules.');
            return;
        }
        haptic();
        appliedSrcRef.current = null;
        setActiveCropAspect(null);
        setWorkingSrc(selection.src);
        setEditOpen(true);
        setSheet(true);
    }, [selection.src]);

    const closeEdit = () => {
        if (editing) return;
        removeWorkingFile(workingSrcRef.current);
        setEditOpen(false);
        setSheet(false);
    };

    const applyEdit = () => {
        haptic();
        if (workingSrc !== selection.src) {
            appliedSrcRef.current = workingSrc;
            onUpdate({ src: workingSrc });
        }
        closeEdit();
    };

    const runEdit = async (action: MediaEditAction) => {
        if (editing) return;
        haptic();
        setEditing(true);
        const previous = workingSrcRef.current;
        const result = await editMediaImage(previous, [action]);
        setEditing(false);
        if (!result) {
            Alert.alert(
                'Could not edit image',
                'Image editing failed for this photo.'
            );
            return;
        }
        removeWorkingFile(previous);
        setWorkingSrc(result.uri);
    };

    const openReplace = React.useCallback(() => {
        haptic();
        setReplaceOpen(true);
        setSheet(true);
    }, []);

    const closeReplace = () => {
        setReplaceOpen(false);
        setSheet(false);
    };

    const confirmDelete = React.useCallback(() => {
        haptic();
        setDeleteConfirmOpen(true);
        setSheet(true);
    }, []);

    // Handle triggerAction from floating menu in WebView safely without re-firing loops
    React.useEffect(() => {
        if (!triggerAction) return;
        if (triggerAction.timestamp <= handledTriggerTimestampRef.current) return;
        handledTriggerTimestampRef.current = triggerAction.timestamp;

        const { action } = triggerAction;
        onActionHandled?.();

        if (action === 'caption') openCaption();
        else if (action === 'edit') openEdit();
        else if (action === 'replace') openReplace();
        else if (action === 'delete') confirmDelete();
    }, [triggerAction, openCaption, openEdit, openReplace, confirmDelete, onActionHandled]);

    return (
        <>
            {/* Caption editor modal */}
            <Modal
                visible={captionOpen}
                transparent
                animationType="none"
                statusBarTranslucent
                onRequestClose={closeCaption}
            >
                <View style={styles.modalBackdrop}>
                    <Animated.View
                        entering={FadeIn.duration(220).easing(EASE_ENTER)}
                        style={[StyleSheet.absoluteFill, styles.dim]}
                    />
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeCaption} />
                    <KeyboardAvoidingView
                        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                        style={styles.keyboardAvoid}
                        pointerEvents="box-none"
                    >
                        <Animated.View
                            entering={DIALOG_ENTER}
                            style={[styles.captionCard, { backgroundColor: colors.card }]}
                            pointerEvents="auto"
                        >
                            <ThemedText style={[styles.modalTitle, { color: colors.text }]}>
                                Image Caption
                            </ThemedText>
                            <ThemedText style={[styles.modalHint, { color: colors.secondary }]}>
                                Displayed directly beneath the image.
                            </ThemedText>

                            <View
                                style={[
                                    styles.captionInputContainer,
                                    { backgroundColor: colors.surface },
                                ]}
                            >
                                <TextInput
                                    value={captionDraft}
                                    onChangeText={setCaptionDraft}
                                    autoFocus
                                    autoCapitalize="sentences"
                                    placeholder="Write a caption..."
                                    placeholderTextColor={colors.secondary}
                                    maxLength={CAPTION_MAX_LENGTH}
                                    multiline={false}
                                    selectionColor={colors.tint}
                                    style={[styles.captionInput, { color: colors.text }]}
                                />
                                {captionDraft.length > 0 && (
                                    <ScalePressable
                                        onPress={() => setCaptionDraft('')}
                                        style={styles.clearBtn}
                                        innerStyle={{ borderRadius: 12 }}
                                        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                                        accessibilityLabel="Clear caption"
                                    >
                                        <Icon name="close_circle_fill" size={18} color={colors.secondary} />
                                    </ScalePressable>
                                )}
                            </View>

                            <ThemedText style={[styles.charCount, { color: colors.secondary }]}>
                                {captionDraft.length}/{CAPTION_MAX_LENGTH}
                            </ThemedText>

                            <View style={styles.modalActions}>
                                <ScalePressable
                                    onPress={closeCaption}
                                    style={[styles.dialogBtn, { backgroundColor: colors.surface }]}
                                    innerStyle={{ borderRadius: 14 }}
                                    accessibilityLabel="Cancel caption"
                                >
                                    <ThemedText style={[styles.cancelBtnText, { color: colors.secondary }]}>
                                        Cancel
                                    </ThemedText>
                                </ScalePressable>
                                <ScalePressable
                                    onPress={saveCaption}
                                    haptic={false}
                                    style={[styles.dialogBtn, { backgroundColor: colors.tint }]}
                                    innerStyle={{ borderRadius: 14 }}
                                    accessibilityLabel="Save caption"
                                >
                                    <ThemedText style={styles.saveBtnText}>
                                        Save Caption
                                    </ThemedText>
                                </ScalePressable>
                            </View>
                        </Animated.View>
                    </KeyboardAvoidingView>
                </View>
            </Modal>

            {/* Image editing sheet */}
            <Modal
                visible={editOpen}
                transparent
                animationType="none"
                statusBarTranslucent
                onRequestClose={closeEdit}
            >
                <View style={styles.sheetOverlay}>
                    <Animated.View
                        entering={FadeIn.duration(220).easing(EASE_ENTER)}
                        style={[StyleSheet.absoluteFill, styles.dim]}
                    />
                    <Pressable style={StyleSheet.absoluteFill} onPress={closeEdit} />
                    <Animated.View
                        entering={SHEET_ENTER}
                        style={[
                            styles.editSheet,
                            {
                                backgroundColor: colors.card,
                                paddingBottom: 20 + insets.bottom,
                            },
                        ]}
                    >
                        <View style={[styles.sheetHandle, { backgroundColor: colors.border }]} />

                        <View style={styles.sheetHeader}>
                            <ThemedText style={[styles.sheetTitle, { color: colors.text }]}>
                                Edit Photo
                            </ThemedText>
                        </View>

                        <View style={[styles.previewFrame, { backgroundColor: colors.surface }]}>
                            <Image
                                source={{ uri: workingSrc }}
                                style={styles.preview}
                                resizeMode="contain"
                            />
                            {editing && (
                                <View style={styles.previewBusy}>
                                    <ActivityIndicator size="large" color="#ffffff" />
                                </View>
                            )}
                        </View>

                        <View style={styles.editActions}>
                            <EditAction
                                icon="refresh_anticlockwise_1_line"
                                label="Rotate -90°"
                                color={colors.text}
                                onPress={() => runEdit({ type: 'rotate', degrees: -90 })}
                            />
                            <EditAction
                                icon="refresh_1_line"
                                label="Rotate +90°"
                                color={colors.text}
                                onPress={() => runEdit({ type: 'rotate', degrees: 90 })}
                            />
                            <EditAction
                                icon="flip_horizontal_line"
                                label="Flip H"
                                color={colors.text}
                                onPress={() => runEdit({ type: 'flip', axis: 'horizontal' })}
                            />
                            <EditAction
                                icon="flip_vertical_line"
                                label="Flip V"
                                color={colors.text}
                                onPress={() => runEdit({ type: 'flip', axis: 'vertical' })}
                            />
                        </View>

                        <ThemedText style={[styles.cropLabel, { color: colors.secondary }]}>
                            Aspect Presets
                        </ThemedText>
                        <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.cropRow}
                        >
                            {CROP_PRESETS.map(preset => {
                                const active = activeCropAspect === preset.aspect;
                                return (
                                    <ScalePressable
                                        key={preset.label}
                                        disabled={editing}
                                        haptic={false}
                                        onPress={() => {
                                            setActiveCropAspect(preset.aspect);
                                            if (preset.aspect === null) {
                                                removeWorkingFile(workingSrcRef.current);
                                                setWorkingSrc(selection.src);
                                                haptic();
                                                return;
                                            }
                                            runEdit({ type: 'crop', aspect: preset.aspect });
                                        }}
                                        style={[
                                            styles.cropChip,
                                            { backgroundColor: active ? colors.tint + '22' : colors.surface },
                                        ]}
                                        innerStyle={{ borderRadius: 12 }}
                                        accessibilityLabel={preset.label}
                                    >
                                        <ThemedText
                                            style={[
                                                styles.cropChipText,
                                                { color: active ? colors.tint : colors.text },
                                            ]}
                                        >
                                            {preset.label}
                                        </ThemedText>
                                    </ScalePressable>
                                );
                            })}
                        </ScrollView>

                        <View style={styles.sheetFooter}>
                            <ScalePressable
                                onPress={closeEdit}
                                style={[styles.sheetCancelBtn, { backgroundColor: colors.surface }]}
                                innerStyle={{ borderRadius: 14 }}
                                accessibilityLabel="Cancel photo editing"
                            >
                                <ThemedText style={[styles.cancelBtnText, { color: colors.secondary }]}>
                                    Cancel
                                </ThemedText>
                            </ScalePressable>
                            <ScalePressable
                                onPress={applyEdit}
                                haptic={false}
                                disabled={editing}
                                style={[styles.sheetApplyBtn, { backgroundColor: colors.tint }]}
                                innerStyle={{ borderRadius: 14 }}
                                accessibilityLabel="Apply photo changes"
                            >
                                <ThemedText style={styles.saveBtnText}>
                                    Apply Changes
                                </ThemedText>
                            </ScalePressable>
                        </View>
                    </Animated.View>
                </View>
            </Modal>

            {/* Photo replacement picker sheet */}
            <PhotoSourceSheet
                visible={replaceOpen}
                title="Replace Photo"
                onClose={closeReplace}
                onPicked={image => {
                    closeReplace();
                    haptic();
                    onUpdate({ src: image.uri });
                }}
            />

            {/* Centered Delete Confirmation Dialog */}
            <Modal
                visible={deleteConfirmOpen}
                transparent
                animationType="none"
                statusBarTranslucent
                onRequestClose={() => {
                    setDeleteConfirmOpen(false);
                    setSheet(false);
                }}
            >
                <View style={styles.modalBackdrop}>
                    <Animated.View
                        entering={FadeIn.duration(220).easing(EASE_ENTER)}
                        style={[StyleSheet.absoluteFill, styles.dim]}
                    />
                    <Pressable
                        style={StyleSheet.absoluteFill}
                        onPress={() => {
                            setDeleteConfirmOpen(false);
                            setSheet(false);
                        }}
                    />
                    <Animated.View
                        entering={DIALOG_ENTER}
                        style={[styles.deleteCard, { backgroundColor: colors.card }]}
                        pointerEvents="auto"
                    >
                        <ThemedText style={[styles.deleteTitle, { color: colors.text }]}>
                            Delete Photo?
                        </ThemedText>
                        <ThemedText style={[styles.deleteDescription, { color: colors.secondary }]}>
                            This will remove the photo from your note.
                        </ThemedText>
                        <View style={styles.deleteActions}>
                            <ScalePressable
                                onPress={() => {
                                    haptic(Haptics.ImpactFeedbackStyle.Medium);
                                    setDeleteConfirmOpen(false);
                                    setSheet(false);
                                    onDelete();
                                }}
                                haptic={false}
                                style={[styles.deleteActionBtn, { backgroundColor: '#ef4444' }]}
                                innerStyle={{ borderRadius: 16 }}
                                accessibilityLabel="Delete photo"
                            >
                                <ThemedText style={styles.deleteConfirmText}>
                                    Delete
                                </ThemedText>
                            </ScalePressable>
                            <ScalePressable
                                onPress={() => {
                                    setDeleteConfirmOpen(false);
                                    setSheet(false);
                                }}
                                style={[styles.deleteActionBtn, { backgroundColor: colors.surface }]}
                                innerStyle={{ borderRadius: 16 }}
                                accessibilityLabel="Cancel delete"
                            >
                                <ThemedText style={[styles.deleteCancelText, { color: colors.text }]}>
                                    Cancel
                                </ThemedText>
                            </ScalePressable>
                        </View>
                    </Animated.View>
                </View>
            </Modal>
        </>
    );
}

function EditAction({
    icon,
    label,
    color,
    onPress,
}: {
    icon: any;
    label: string;
    color: string;
    onPress: () => void;
}) {
    return (
        <ScalePressable
            onPress={onPress}
            haptic={false}
            style={styles.editAction}
            innerStyle={{ borderRadius: 12 }}
            accessibilityLabel={label}
        >
            <Icon name={icon} size={20} color={color} />
            <ThemedText style={[styles.editActionLabel, { color }]}>{label}</ThemedText>
        </ScalePressable>
    );
}

const styles = StyleSheet.create({
    modalBackdrop: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingHorizontal: 20,
    },
    dim: {
        backgroundColor: 'rgba(0, 0, 0, 0.55)',
    },
    keyboardAvoid: {
        width: '100%',
        maxWidth: 420,
        alignItems: 'center',
    },
    deleteCard: {
        width: '100%',
        maxWidth: 320,
        borderRadius: 22,
        padding: 22,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
        elevation: 12,
    },
    deleteTitle: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.bold,
        marginBottom: 8,
        textAlign: 'center',
    },
    deleteDescription: {
        fontSize: 14,
        lineHeight: 20,
        marginBottom: 20,
        textAlign: 'center',
    },
    deleteActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
    },
    deleteActionBtn: {
        flex: 1,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 16,
    },
    deleteConfirmText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.semibold,
        color: '#ffffff',
    },
    deleteCancelText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.semibold,
    },
    captionCard: {
        width: '100%',
        borderRadius: 22,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 12 },
        shadowOpacity: 0.35,
        shadowRadius: 20,
        elevation: 12,
    },
    modalTitle: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.bold,
        marginBottom: 2,
    },
    modalHint: {
        fontSize: 13,
        marginTop: 4,
        marginBottom: 14,
        lineHeight: 18,
    },
    captionInputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        borderRadius: 14,
        paddingHorizontal: 12,
    },
    captionInput: {
        flex: 1,
        fontSize: 15,
        minHeight: 46,
        paddingVertical: 10,
    },
    clearBtn: {
        padding: 6,
    },
    charCount: {
        fontSize: 12,
        alignSelf: 'flex-end',
        marginTop: 6,
    },
    modalActions: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        marginTop: 16,
    },
    dialogBtn: {
        flex: 1,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
    },
    cancelBtnText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.medium,
    },
    saveBtnText: {
        fontSize: 15,
        fontFamily: Typography.fontFamily.semibold,
        color: '#ffffff',
    },
    sheetOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    editSheet: {
        borderTopLeftRadius: 26,
        borderTopRightRadius: 26,
        paddingTop: 10,
        paddingBottom: 24,
        paddingHorizontal: 16,
        maxHeight: '85%',
    },
    sheetHandle: {
        width: 38,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 8,
        opacity: 0.45,
    },
    sheetHeader: {
        alignItems: 'center',
        marginBottom: 12,
    },
    sheetTitle: {
        fontSize: 17,
        fontFamily: Typography.fontFamily.bold,
    },
    previewFrame: {
        height: 210,
        borderRadius: 16,
        overflow: 'hidden',
        justifyContent: 'center',
        alignItems: 'center',
    },
    preview: {
        width: '100%',
        height: '100%',
    },
    previewBusy: {
        ...StyleSheet.absoluteFill,
        backgroundColor: 'rgba(0, 0, 0, 0.4)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    editActions: {
        flexDirection: 'row',
        gap: 8,
        marginTop: 14,
    },
    editAction: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 4,
        paddingVertical: 10,
        borderRadius: 12,
        backgroundColor: 'rgba(128, 128, 128, 0.1)',
    },
    editActionLabel: {
        fontSize: 11,
        fontFamily: Typography.fontFamily.medium,
        textAlign: 'center',
    },
    cropLabel: {
        fontSize: 11,
        fontFamily: Typography.fontFamily.semibold,
        letterSpacing: 0.8,
        marginTop: 16,
        marginBottom: 8,
    },
    cropRow: {
        gap: 8,
        paddingRight: 8,
    },
    cropChip: {
        borderRadius: 12,
        paddingHorizontal: 14,
        paddingVertical: 7,
        alignItems: 'center',
    },
    cropChipText: {
        fontSize: 13,
        fontFamily: Typography.fontFamily.semibold,
    },
    sheetFooter: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginTop: 24,
        gap: 12,
    },
    sheetCancelBtn: {
        flex: 1,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
    },
    sheetApplyBtn: {
        flex: 2,
        height: 50,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
    },
});
