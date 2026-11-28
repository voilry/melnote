import { View, StyleSheet, Modal, ScrollView, Pressable, Platform } from 'react-native';
import { ScalePressable } from '../ui/ScalePressable';
import { ThemedText } from '../ui/ThemedText';
import { DesignSystem } from '../../constants/DesignSystem';
import { Typography } from '../../constants/Typography';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Check, Folder } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import Animated, { Easing, FadeIn, FadeInDown, FadeOut, SlideInDown, FadeOutDown } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Group } from '../../db/repositories/GroupRepository';
import { getGroupIcon } from '../../constants/GroupIcons';
import { useModalPresence } from '../ui/useModalPresence';

interface ManageGroupsModalProps {
    visible: boolean;
    onClose: () => void;
    personName: string;
    allGroups: Group[];
    personGroups: Group[];
    onToggleGroup: (groupId: number) => Promise<void>;
}

const EASE_ENTER = Easing.bezier(0.05, 0.7, 0.1, 1.0);

export function ManageGroupsModal({ visible, onClose, personName, allGroups, personGroups, onToggleGroup }: ManageGroupsModalProps) {
    const { colors, hapticsEnabled } = useAppTheme();
    const insets = useSafeAreaInsets();
    const { mounted, showContent } = useModalPresence(visible);

    const triggerHaptic = () => {
        if (hapticsEnabled && Platform.OS !== 'web') {
            Haptics.selectionAsync().catch(() => {});
        }
    };

    return (
        <Modal
            visible={mounted}
            animationType="none"
            transparent={true}
            onRequestClose={onClose}
            statusBarTranslucent
        >
            {showContent && (
                <View style={styles.modalOverlay}>
                    <Animated.View
                        entering={FadeIn.duration(240).easing(EASE_ENTER)}
                        exiting={FadeOut.duration(220)}
                        style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.7)' }]}
                    />
                    <View style={{ flex: 1, justifyContent: 'flex-end' }}>
                        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
                        <Animated.View
                            entering={SlideInDown.duration(360).easing(EASE_ENTER)}
                            exiting={FadeOutDown.duration(260).easing(Easing.bezier(0.4, 0, 0.5, 1))}
                            style={[
                                styles.bottomSheet,
                                {
                                    backgroundColor: colors.card,
                                    paddingBottom: 100 + insets.bottom + 32,
                                }
                            ]}
                        >
                            <View style={styles.handle} />
                            <View style={styles.sheetHeader}>
                                <ThemedText style={[styles.sheetTitle, { color: colors.text }]}>Manage Groups</ThemedText>
                                <ThemedText type="small" style={[styles.sheetSubtitle, { color: colors.secondary }]}>
                                    Add or remove {personName} from groups
                                </ThemedText>
                            </View>

                            <ScrollView
                                style={{ maxHeight: 500 }}
                                showsVerticalScrollIndicator={false}
                                contentContainerStyle={{ paddingBottom: 20 }}
                            >
                                {allGroups.length > 0 ? (
                                    allGroups.map((g, index) => {
                                        const isSelected = personGroups.some(pg => pg.id === g.id);
                                        const groupColor = g.color || colors.tint;
                                        const IconComponent = getGroupIcon(g.icon);

                                        return (
                                            <Animated.View
                                                key={g.id}
                                                entering={FadeInDown.delay(60 + Math.min(index, 8) * 26)
                                                    .duration(300)
                                                    .easing(EASE_ENTER)}
                                            >
                                                <ScalePressable
                                                    style={[
                                                        styles.groupOption,
                                                        { backgroundColor: colors.surface },
                                                    ]}
                                                    onPress={() => {
                                                        triggerHaptic();
                                                        onToggleGroup(g.id);
                                                    }}
                                                    scaleTo={0.96}
                                                    haptic={false}
                                                    accessibilityRole="button"
                                                    accessibilityLabel={`${g.name}, ${isSelected ? 'in group' : 'not in group'}`}
                                                >
                                                    <View style={styles.groupIdentity}>
                                                        <IconComponent
                                                            size={22}
                                                            color={isSelected ? groupColor : colors.secondary}
                                                            weight={isSelected ? 'fill' : 'regular'}
                                                        />
                                                        <ThemedText
                                                            numberOfLines={1}
                                                            style={[
                                                                styles.groupName,
                                                                {
                                                                    color: isSelected ? colors.text : colors.secondary,
                                                                    fontFamily: isSelected
                                                                        ? Typography.fontFamily.bold
                                                                        : Typography.fontFamily.medium,
                                                                },
                                                            ]}
                                                        >
                                                            {g.name}
                                                        </ThemedText>
                                                    </View>
                                                    <View
                                                        style={[
                                                            styles.checkCircle,
                                                            {
                                                                backgroundColor: isSelected ? groupColor : 'transparent',
                                                                borderColor: isSelected ? groupColor : colors.border,
                                                            },
                                                        ]}
                                                    >
                                                        {isSelected && <Check size={12} color="#fff" weight="bold" />}
                                                    </View>
                                                </ScalePressable>
                                            </Animated.View>
                                        );
                                    })
                                ) : (
                                    <View style={styles.emptyState}>
                                        <Folder size={64} color={colors.secondary + '4D'} />
                                        <ThemedText style={[styles.emptyTitle, { color: colors.secondary }]}>
                                            No groups created yet
                                        </ThemedText>
                                    </View>
                                )}
                            </ScrollView>
                        </Animated.View>
                    </View>
                </View>
            )}
        </Modal>
    );
}

const styles = StyleSheet.create({
    modalOverlay: {
        flex: 1,
        justifyContent: 'flex-end',
    },
    bottomSheet: {
        borderTopLeftRadius: 32,
        borderTopRightRadius: 32,
        paddingHorizontal: 24,
        paddingTop: 24,
        minHeight: 500,
        marginBottom: -100,
        ...DesignSystem.shadows.xl,
    },
    handle: {
        width: 40,
        height: 5,
        backgroundColor: 'rgba(128,128,128,0.2)',
        borderRadius: 2.5,
        alignSelf: 'center',
        marginBottom: 24,
    },
    sheetHeader: {
        marginBottom: 24,
    },
    sheetTitle: {
        fontSize: 18,
        fontFamily: Typography.fontFamily.serif,
    },
    sheetSubtitle: {
        marginTop: 4,
    },
    groupOption: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 14,
        borderRadius: DesignSystem.radius.lg,
        marginBottom: 10,
    },
    groupIdentity: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 16,
    },
    groupName: {
        fontSize: 17,
        lineHeight: 22,
        flexShrink: 1,
    },
    checkCircle: {
        width: 24,
        height: 24,
        borderRadius: 12,
        borderWidth: 2,
        justifyContent: 'center',
        alignItems: 'center',
    },
    emptyState: {
        paddingTop: 60,
        alignItems: 'center',
    },
    emptyTitle: {
        marginTop: 16,
        textAlign: 'center',
        fontSize: 16,
    },
});
