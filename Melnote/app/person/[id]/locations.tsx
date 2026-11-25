import React, { useState, useEffect, useMemo } from 'react';
import { View, StyleSheet, Platform, Linking, BackHandler } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { ThemedView } from '../../../components/ui/ThemedView';
import { ThemedText } from '../../../components/ui/ThemedText';
import { PersonRepository, Person } from '../../../db/repositories/PersonRepository';
import { DesignSystem } from '../../../constants/DesignSystem';
import { ScreenHeader } from '../../../components/ui/ScreenHeader';
import { Input } from '../../../components/ui/Input';
import { ScalePressable } from '../../../components/ui/ScalePressable';
import { useAppTheme } from '../../../hooks/useAppTheme';
import { House as Home, Briefcase, Airplane as Plane, Check, NavigationArrow as Navigation } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Typography } from '../../../constants/Typography';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useFocusEffect } from 'expo-router/react-navigation';
import { DeleteModal } from '../../../components/ui/DeleteModal';
import { showToast } from '../../../components/ui/Toast';

export default function PersonLocationsScreen() {
    const { id } = useLocalSearchParams();
    const router = useRouter();
    const { colors, theme, hapticsEnabled } = useAppTheme();
    const insets = useSafeAreaInsets();
    const personId = Number(id);

    const [person, setPerson] = useState<Person | null>(null);
    const [locationHome, setLocationHome] = useState('');
    const [locationWork, setLocationWork] = useState('');
    const [locationOther, setLocationOther] = useState('');
    const [originalData, setOriginalData] = useState({ home: '', work: '', other: '' });
    const [isSaving, setIsSaving] = useState(false);
    const [showDiscardModal, setShowDiscardModal] = useState(false);
    const [loadFailed, setLoadFailed] = useState(false);

    useEffect(() => {
        if (id) loadData();
    }, [id]);

    const loadData = async () => {
        try {
            const p = await PersonRepository.getById(personId);
            if (p) {
                setPerson(p);
                const data = {
                    home: p.locationHome || '',
                    work: p.locationWork || '',
                    other: p.locationOther || ''
                };
                setLocationHome(data.home);
                setLocationWork(data.work);
                setLocationOther(data.other);
                setOriginalData(data);
            } else {
                setLoadFailed(true);
            }
        } catch (error) {
            // Without this the screen would stay blank with no way out.
            console.error('Failed to load locations:', error);
            setLoadFailed(true);
        }
    };

    const hasChanges = useMemo(() => {
        return (
            locationHome.trim() !== originalData.home ||
            locationWork.trim() !== originalData.work ||
            locationOther.trim() !== originalData.other
        );
    }, [locationHome, locationWork, locationOther, originalData]);

    useFocusEffect(
        React.useCallback(() => {
            const onBackPress = () => {
                if (hasChanges) {
                    setShowDiscardModal(true);
                    return true;
                }
                return false;
            };

            const subscription = BackHandler.addEventListener('hardwareBackPress', onBackPress);
            return () => subscription.remove();
        }, [hasChanges])
    );

    const handleBack = () => {
        if (hasChanges) {
            setShowDiscardModal(true);
        } else {
            router.back();
        }
    };

    const handleSave = async () => {
        if (!person || isSaving) return;
        setIsSaving(true);
        if (hapticsEnabled && Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});

        try {
            await PersonRepository.update(personId, {
                locationHome: locationHome.trim(),
                locationWork: locationWork.trim(),
                locationOther: locationOther.trim()
            });
            router.back();
        } catch (error) {
            // Without this the save button would stay disabled forever and the
            // screen would look like it had saved.
            console.error('Failed to save locations:', error);
            showToast('Could not save locations');
        } finally {
            setIsSaving(false);
        }
    };

    const handleOpenMap = (value: string) => {
        if (!value.trim()) return;
        const query = encodeURIComponent(value);
        const url = Platform.select({
            ios: `maps://0,0?q=${query}`,
            android: `geo:0,0?q=${query}`,
            default: `https://www.google.com/maps/search/?api=1&query=${query}`
        });
        // A device without a maps app rejects the intent - say so instead of
        // letting the rejection disappear.
        Linking.openURL(url as string).catch(() => {
            showToast('Could not open the map');
        });
    };

    if (!person) {
        return (
            <ThemedView style={[styles.container, styles.notFound]}>
                <Stack.Screen options={{ headerShown: false }} />
                {loadFailed && (
                    <>
                        <ThemedText style={styles.notFoundTitle}>Locations unavailable</ThemedText>
                        <ThemedText style={[styles.notFoundBody, { color: colors.secondary }]}>
                            This profile may have been deleted, or something went wrong while reading it.
                        </ThemedText>
                        <ScalePressable
                            onPress={() => {
                                if (router.canGoBack()) router.back();
                                else router.replace('/');
                            }}
                            style={[styles.notFoundButton, { backgroundColor: colors.tint }]}
                            innerStyle={{ borderRadius: 18 }}
                            scaleTo={0.96}
                            accessibilityRole="button"
                            accessibilityLabel="Go back"
                        >
                            <ThemedText style={[styles.notFoundButtonText, { color: colors.tintContrast }]}>
                                Go back
                            </ThemedText>
                        </ScalePressable>
                    </>
                )}
            </ThemedView>
        );
    }

    return (
        <ThemedView style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />
            <StatusBar style="auto" />

            <ScreenHeader
                onBack={handleBack}
                style={styles.header}
                alignCenter={false}
                centerContent={
                    <View style={{ flex: 1, alignItems: 'flex-start' }}>
                        <ThemedText type="display" style={{ fontSize: 28, lineHeight: 32 }}>Places</ThemedText>
                        <ThemedText style={{ fontSize: 10, color: colors.secondary, marginTop: -6, fontFamily: Typography.fontFamily.medium, textTransform: 'uppercase' }}>
                            {person.name}'s locations
                        </ThemedText>
                    </View>
                }
                rightContent={
                    <View style={{ width: 44, height: 44, justifyContent: 'center', alignItems: 'center' }}>
                        {hasChanges && (
                            <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(200)}>
                                <ScalePressable
                                    onPress={handleSave}
                                    disabled={isSaving}
                                    style={[styles.saveButton, { backgroundColor: colors.tint }]}
                                    innerStyle={{ borderRadius: 22 }}
                                    springConfig={DesignSystem.animation.springs.heavy}
                                    scaleTo={0.9}
                                    overlayColor="rgba(0,0,0,0.15)"
                                >
                                    <Check size={20} color={theme === 'light' ? '#fff' : '#000'} weight="bold" />
                                </ScalePressable>
                            </Animated.View>
                        )}
                    </View>
                }
            />

            <KeyboardAwareScrollView
                style={{ flex: 1 }}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 20 }]}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                bottomOffset={24}
            >
                    <View style={{ height: 12 }} />

                    <LocationInputRow
                        label="Home"
                        value={locationHome}
                        onChangeText={setLocationHome}
                        placeholder="Residential address..."
                        icon={<Home size={22} color={colors.icon} weight="duotone" />}
                        onOpenMap={() => handleOpenMap(locationHome)}
                        colors={colors}
                    />

                    <LocationInputRow
                        label="Work"
                        value={locationWork}
                        onChangeText={setLocationWork}
                        placeholder="Office or workplace..."
                        icon={<Briefcase size={22} color={colors.icon} weight="duotone" />}
                        onOpenMap={() => handleOpenMap(locationWork)}
                        colors={colors}
                    />

                    <LocationInputRow
                        label="Other"
                        value={locationOther}
                        onChangeText={setLocationOther}
                        placeholder="Vacation home, frequent spot..."
                        icon={<Plane size={22} color={colors.icon} weight="duotone" />}
                        onOpenMap={() => handleOpenMap(locationOther)}
                        colors={colors}
                    />

            </KeyboardAwareScrollView>

            <DeleteModal
                visible={showDiscardModal}
                title="Discard Changes"
                description="Are you sure you want to discard your edits? Any changes you made will be lost."
                onCancel={() => setShowDiscardModal(false)}
                onDelete={() => {
                    setShowDiscardModal(false);
                    router.back();
                }}
                actionLabel="Discard"
            />
        </ThemedView>
    );
}

function LocationInputRow({ label, value, onChangeText, placeholder, icon, onOpenMap, colors }: any) {
    return (
        <View style={styles.inputRow}>
            <View style={styles.inputRowHeader}>
                <View style={styles.labelGroup}>
                    {icon}
                    <ThemedText style={styles.inputLabel}>{label}</ThemedText>
                </View>
                {onOpenMap && value.trim().length > 0 && (
                    <ScalePressable
                        onPress={onOpenMap}
                        style={styles.mapAction}
                        springConfig={DesignSystem.animation.springs.fast}
                        scaleTo={0.9}
                        overlayColor="rgba(0,0,0,0.15)"
                    >
                        <Navigation size={18} color={colors.tint} weight="bold" />
                    </ScalePressable>
                )}
            </View>
            <Input
                value={value}
                onChangeText={onChangeText}
                placeholder={placeholder}
                style={styles.input}
            />
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    header: { paddingBottom: 12 },
    saveButton: {
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContent: {
        flexGrow: 1,
        paddingHorizontal: 20,
    },
    inputRow: {
        marginBottom: 16,
    },
    inputRowHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: 4,
        paddingHorizontal: 4,
    },
    labelGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
    },
    inputLabel: {
        fontSize: 14,
        fontFamily: Typography.fontFamily.bold,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        opacity: 0.6,
    },
    input: {
        marginBottom: 0,
    },
    mapAction: {
        width: 32,
        height: 32,
        borderRadius: 16,
        justifyContent: 'center',
        alignItems: 'center',
    },
    notFound: {
        alignItems: 'center',
        justifyContent: 'center',
        padding: 28,
    },
    notFoundTitle: {
        fontSize: 20,
        lineHeight: 26,
        letterSpacing: -0.4,
        textAlign: 'center',
        fontFamily: Typography.fontFamily.serif,
    },
    notFoundBody: {
        marginTop: 8,
        fontSize: 13.5,
        lineHeight: 19,
        textAlign: 'center',
        fontFamily: Typography.fontFamily.regular,
    },
    notFoundButton: {
        marginTop: 20,
        paddingHorizontal: 22,
        paddingVertical: 12,
        borderRadius: 18,
    },
    notFoundButtonText: {
        fontSize: 14.5,
        fontFamily: Typography.fontFamily.bold,
    },
});
