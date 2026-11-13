import React from 'react';
import {
    ActivityIndicator,
    Alert,
    Modal,
    Platform,
    Pressable,
    StyleSheet,
    View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import Animated, { Easing, FadeIn, SlideInDown } from 'react-native-reanimated';
import { ThemedText } from './ThemedText';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Typography';
import { Camera, PhotoAlbum } from '@/components/ui/Icon';
import { importPickedImage, type ImportedImage } from '../../utils/media';
import { ScalePressable } from './ScalePressable';

const EASE_ENTER = Easing.bezier(0.05, 0.7, 0.1, 1.0);
const SHEET_ENTER = SlideInDown.duration(320).springify().damping(24).stiffness(240).mass(0.9);

interface PhotoSourceSheetProps {
    visible: boolean;
    onClose: () => void;
    /** Called with the imported (already stored) image. */
    onPicked: (image: ImportedImage) => void;
    title?: string;
}

/**
 * Shared "where from?" sheet used when adding OR replacing an image.
 *
 * Owns the permission prompts, picker launch and media import so every caller
 * gets a stored `media/<id>.jpg` reference rather than a transient picker URI.
 */
export function PhotoSourceSheet({ visible, onClose, onPicked, title }: PhotoSourceSheetProps) {
    const { colors } = useAppTheme();
    const [importing, setImporting] = React.useState(false);

    const pick = async (source: 'library' | 'camera') => {
        if (importing) return;
        setImporting(true);
        try {
            const permission = source === 'camera'
                ? await ImagePicker.requestCameraPermissionsAsync()
                : await ImagePicker.requestMediaLibraryPermissionsAsync();
            if (!permission.granted) {
                Alert.alert(
                    'Permission needed',
                    source === 'camera'
                        ? 'Melnote needs camera access to take a photo for your note.'
                        : 'Melnote needs access to your photos to add one to your note.'
                );
                return;
            }

            const result = source === 'camera'
                ? await ImagePicker.launchCameraAsync({ quality: 1, allowsEditing: false })
                : await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    quality: 1,
                    allowsEditing: false,
                    selectionLimit: 1,
                });

            if (result.canceled || !result.assets?.length) return;

            const image = await importPickedImage(result.assets[0]);
            onClose();
            onPicked(image);
        } catch (_error) {
            Alert.alert(
                'Could not add image',
                'That photo could not be added. Try a different image.'
            );
        } finally {
            setImporting(false);
        }
    };

    return (
        <Modal
            visible={visible}
            transparent
            animationType="none"
            statusBarTranslucent
            onRequestClose={onClose}
        >
            <Pressable style={styles.backdrop} onPress={onClose}>
                <Animated.View
                    entering={FadeIn.duration(220).easing(EASE_ENTER)}
                    style={[StyleSheet.absoluteFill, styles.dim]}
                    pointerEvents="none"
                />
                <Animated.View
                    entering={SHEET_ENTER}
                    style={[styles.sheet, { backgroundColor: colors.background }]}
                    onStartShouldSetResponder={() => true}
                >
                    <View style={[styles.handle, { backgroundColor: colors.border }]} />

                    {title ? (
                        <ThemedText style={[styles.title, { color: colors.secondary }]}>
                            {title}
                        </ThemedText>
                    ) : null}

                    <ScalePressable
                        style={styles.row}
                        innerStyle={{ borderRadius: 12 }}
                        onPress={() => pick('library')}
                        disabled={importing}
                        accessibilityRole="button"
                        accessibilityLabel="Choose from photo library"
                    >
                        {importing
                            ? <ActivityIndicator size="small" color={colors.tint} />
                            : <PhotoAlbum size={20} color={colors.text} />}
                        <ThemedText style={[styles.label, { color: colors.text }]}>
                            Photo library
                        </ThemedText>
                    </ScalePressable>

                    <View style={[styles.divider, { backgroundColor: colors.border + '30' }]} />

                    <ScalePressable
                        style={styles.row}
                        innerStyle={{ borderRadius: 12 }}
                        onPress={() => pick('camera')}
                        disabled={importing}
                        accessibilityRole="button"
                        accessibilityLabel="Take a photo"
                    >
                        <Camera size={20} color={colors.text} />
                        <ThemedText style={[styles.label, { color: colors.text }]}>
                            Take photo
                        </ThemedText>
                    </ScalePressable>
                </Animated.View>
            </Pressable>
        </Modal>
    );
}

const styles = StyleSheet.create({
    backdrop: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    dim: {
        backgroundColor: 'rgba(0, 0, 0, 0.35)',
    },
    sheet: {
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 8,
        paddingBottom: Platform.OS === 'android' ? 28 : 34,
        paddingHorizontal: 8,
    },
    handle: {
        width: 36,
        height: 4,
        borderRadius: 2,
        alignSelf: 'center',
        marginBottom: 6,
        opacity: 0.5,
    },
    title: {
        fontSize: 13,
        fontFamily: Typography.fontFamily.semibold,
        letterSpacing: 0.2,
        opacity: 0.6,
        paddingHorizontal: 16,
        paddingBottom: 4,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 15,
        paddingHorizontal: 16,
        borderRadius: 12,
        minHeight: 52,
    },
    divider: {
        height: StyleSheet.hairlineWidth,
        marginLeft: 50,
    },
    label: {
        fontSize: 16,
        fontFamily: Typography.fontFamily.medium,
    },
});
