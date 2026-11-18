import React, { useState, useCallback, useRef, useEffect } from 'react';
import { View, StyleSheet, ScrollView, BackHandler } from 'react-native';
import { Stack, useRouter, useFocusEffect } from 'expo-router';
import { ThemedView } from '../../components/ui/ThemedView';
import { ThemedText } from '../../components/ui/ThemedText';
import { Card } from '../../components/ui/Card';
import { Toggle } from '../../components/ui/Toggle';
import { Button } from '../../components/ui/Button';
import { ScreenHeader } from '../../components/ui/ScreenHeader';
import { useAppTheme } from '../../hooks/useAppTheme';
import { useSettings } from '../../store/SettingsContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LockKey, Fingerprint, Clock } from '@/components/ui/Icon';
import * as Haptics from 'expo-haptics';
import * as LocalAuthentication from 'expo-local-authentication';
import { DesignSystem } from '../../constants/DesignSystem';
import { ScalePressable } from '../../components/ui/ScalePressable';
import { AlertModal } from '../../components/ui/AlertModal';
import { DeleteModal } from '../../components/ui/DeleteModal';
import { OptionSheet } from '../../components/ui/OptionSheet';
import { PinKeypad } from '../../components/ui/PinKeypad';
import { Typography } from '../../constants/Typography';
import {
    APP_LOCK_TIMEOUTS,
    PIN_LENGTH,
    authenticateBiometric,
    clearStoredPin,
    sendLockCommand,
    writeStoredPin,
} from '../../utils/appLock';

export default function PrivacySettingsScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { colors } = useAppTheme();
    const { settings, updateSetting } = useSettings();
    const [hasBiometrics, setHasBiometrics] = useState(false);
    const [pinMode, setPinMode] = useState<'idle' | 'create' | 'confirm'>('idle');
    const [tempPin, setTempPin] = useState('');
    const [pinInput, setPinInput] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [alertConfig, setAlertConfig] = useState<{ visible: boolean, title: string, description: string, type: 'success' | 'info' | 'error' | 'warning' } | null>(null);
    const [showDisableConfirm, setShowDisableConfirm] = useState(false);
    const [showTimeoutSheet, setShowTimeoutSheet] = useState(false);
    const biometricBusy = useRef(false);

    const checkBiometrics = useCallback(async () => {
        const hasHardware = await LocalAuthentication.hasHardwareAsync();
        const isEnrolled = await LocalAuthentication.isEnrolledAsync();
        setHasBiometrics(hasHardware && isEnrolled);
    }, []);

    /**
     * Puts the passcode screen away and forgets everything about it.
     *
     * The screen stays mounted in the stack after it has been left, so the
     * state has to be cleared by hand. Without this, walking into the
     * settings and back again lands on the "Create Passcode" screen instead
     * of the settings.
     */
    const cancelPinEntry = useCallback(() => {
        setPinMode('idle');
        setPinInput('');
        setTempPin('');
        setErrorMessage('');
    }, []);

    // The owner may enrol a fingerprint or a face while they are in the
    // phone's settings and come straight back, so the check is repeated
    // every time this screen comes into focus.
    useFocusEffect(
        useCallback(() => {
            void checkBiometrics();

            return () => {
                cancelPinEntry();
            };
        }, [checkBiometrics, cancelPinEntry])
    );

    // On Android the back button is not the header's arrow. While the
    // passcode screen is open it goes back to the settings list instead of
    // leaving the screen altogether, which is what the arrow does.
    useEffect(() => {
        if (pinMode === 'idle') return;

        const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
            cancelPinEntry();
            return true;
        });

        return () => subscription.remove();
    }, [pinMode, cancelPinEntry]);

    const triggerHaptic = () => {
        if (settings.hapticsEnabled) {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        }
    };

    const handleToggleAppLock = async (val: boolean) => {
        triggerHaptic();
        if (val) {
            setPinMode('create');
            setErrorMessage('');
        } else {
            setShowDisableConfirm(true);
        }
    };

    const confirmDisableLock = async () => {
        await clearStoredPin();
        updateSetting('appLockEnabled', false);
        updateSetting('biometricEnabled', false);
        setShowDisableConfirm(false);
        triggerHaptic();
    };

    const handlePinPress = (num: string) => {
        const newVal = pinInput + num;
        if (newVal.length > PIN_LENGTH) return;
        setPinInput(newVal);

        // Typing again clears the note about the last mistake.
        if (errorMessage) setErrorMessage('');

        if (newVal.length === PIN_LENGTH) {
            void handlePinValidation(newVal);
        }
    };

    const handleBackspace = () => {
        setPinInput(prev => prev.slice(0, -1));
        if (errorMessage) setErrorMessage('');
    };

    const handlePinValidation = async (cleaned: string) => {
        if (pinMode === 'create') {
            setTempPin(cleaned);
            setPinInput('');
            setPinMode('confirm');
            setErrorMessage('');
            return;
        }

        if (cleaned !== tempPin) {
            if (settings.hapticsEnabled) {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
            }
            // Go straight back to the start rather than freezing the screen
            // for a second and a half. The note stays up so the owner knows
            // what happened, and it goes away as soon as they type again.
            setPinInput('');
            setTempPin('');
            setPinMode('create');
            setErrorMessage("Those passcodes don't match");
            return;
        }

        const stored = await writeStoredPin(cleaned);
        if (!stored) {
            // The passcode could not be put into the phone's secure storage,
            // so the lock is not switched on - otherwise the app would ask
            // for a passcode it cannot check.
            setPinInput('');
            setTempPin('');
            setPinMode('create');
            setErrorMessage('Could not save the passcode');
            return;
        }

        updateSetting('appLockEnabled', true);
        setPinMode('idle');
        setPinInput('');
        setTempPin('');
        setErrorMessage('');
        setAlertConfig({
            visible: true,
            title: 'Passcode set',
            description: hasBiometrics
                ? 'Melnote is now protected by your passcode. You can turn on biometric unlock below.'
                : 'Melnote is now protected by your passcode.',
            type: 'success',
        });
    };

    if (pinMode !== 'idle') {
        const isConfirming = pinMode === 'confirm';

        return (
            <ThemedView style={styles.container}>
                <Stack.Screen options={{ headerShown: false }} />
                <ScreenHeader
                    title={isConfirming ? 'Confirm Passcode' : 'Create Passcode'}
                    onBack={cancelPinEntry}
                />

                <View style={styles.pinContainer}>
                    <View style={styles.pinHeader}>
                        <ThemedText
                            style={[
                                styles.pinHint,
                                errorMessage ? { color: colors.error } : null,
                            ]}
                        >
                            {errorMessage
                                || (isConfirming
                                    ? `Type your ${PIN_LENGTH}-digit passcode once more.`
                                    : `Choose a ${PIN_LENGTH}-digit passcode.`)}
                        </ThemedText>
                    </View>

                    <PinKeypad
                        length={PIN_LENGTH}
                        value={pinInput}
                        onDigit={handlePinPress}
                        onBackspace={handleBackspace}
                        error={!!errorMessage}
                    />
                </View>
            </ThemedView>
        );
    }

    const handleToggleBiometric = async (val: boolean) => {
        triggerHaptic();

        if (!val) {
            updateSetting('biometricEnabled', false);
            return;
        }

        // Turning it on is only allowed to work if the device accepts the
        // owner right now. A switch that says "biometric unlock is on" but
        // never unlocks anything is worse than no switch at all - and a
        // fingerprint that was never enrolled cannot unlock anything.
        if (biometricBusy.current) return;
        biometricBusy.current = true;

        try {
            const outcome = await authenticateBiometric('Confirm it is you');

            if (outcome === 'success') {
                updateSetting('biometricEnabled', true);
                return;
            }

            setAlertConfig({
                visible: true,
                title: 'Biometric unlock stays off',
                description: outcome === 'cancelled'
                    ? 'The check was cancelled, so biometric unlock was not turned on. Your passcode still works.'
                    : 'This device could not confirm it was you, so biometric unlock was not turned on. Your passcode still works.',
                type: 'warning',
            });
        } finally {
            biometricBusy.current = false;
        }
    };

    const timeoutOption = APP_LOCK_TIMEOUTS.find(option => option.seconds === settings.appLockTimeout)
        ?? APP_LOCK_TIMEOUTS[1];
    const timeoutLabel = timeoutOption.short;

    const handleLockNow = () => {
        triggerHaptic();
        sendLockCommand('lock-now');
    };

    return (
        <ThemedView style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />

            <ScreenHeader
                title="App Lock"
                onBack={() => router.back()}
            />

            <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}
            >
                <View style={styles.section}>
                    <Card style={styles.card} padding="none">
                        <SettingRow
                            label="App Lock"
                            description="Require a passcode to open Melnote."
                            icon={<LockKey size={20} color={colors.tint} weight="duotone" />}
                        >
                            <Toggle
                                value={settings.appLockEnabled}
                                onValueChange={handleToggleAppLock}
                            />
                        </SettingRow>

                        {settings.appLockEnabled && (
                            <>
                                <Separator />
                                <SettingRow
                                    label="Biometric unlock"
                                    description={hasBiometrics
                                        ? 'Use your fingerprint or face instead of the passcode.'
                                        : 'No fingerprint or face is enrolled on this device.'}
                                    icon={(
                                        <Fingerprint
                                            size={20}
                                            color={hasBiometrics ? colors.tint : colors.textTertiary}
                                            weight="duotone"
                                        />
                                    )}
                                >
                                    {hasBiometrics && (
                                        <Toggle
                                            value={settings.biometricEnabled}
                                            onValueChange={handleToggleBiometric}
                                        />
                                    )}
                                </SettingRow>
                            </>
                        )}
                    </Card>
                </View>

                {settings.appLockEnabled && (
                    <View style={styles.section}>
                        <Card style={styles.card} padding="none">
                            <ScalePressable
                                onPress={() => {
                                    triggerHaptic();
                                    setShowTimeoutSheet(true);
                                }}
                                style={styles.rowPress}
                                innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                                accessibilityRole="button"
                                accessibilityLabel={`Lock after ${timeoutOption.label}`}
                            >
                                <SettingRow
                                    label="Lock after"
                                    description="How long Melnote may be away before it locks again."
                                    icon={<Clock size={20} color={colors.tint} weight="duotone" />}
                                >
                                    <ThemedText style={[styles.rowValue, { color: colors.secondary }]}>
                                        {timeoutLabel}
                                    </ThemedText>
                                </SettingRow>
                            </ScalePressable>
                        </Card>
                    </View>
                )}

                {settings.appLockEnabled && (
                    <View style={styles.buttonStack}>
                        <Button
                            title="Lock now"
                            variant="secondary"
                            onPress={handleLockNow}
                        />
                        <Button
                            title="Change Passcode"
                            variant="secondary"
                            onPress={() => {
                                triggerHaptic();
                                setPinMode('create');
                                setErrorMessage('');
                            }}
                        />
                    </View>
                )}
            </ScrollView>

            <OptionSheet
                visible={showTimeoutSheet}
                title="Lock after"
                options={APP_LOCK_TIMEOUTS.map(option => ({
                    label: option.label,
                    value: option.seconds,
                }))}
                selectedValue={settings.appLockTimeout}
                onSelect={(value: number) => {
                    triggerHaptic();
                    updateSetting('appLockTimeout', value);
                }}
                onClose={() => setShowTimeoutSheet(false)}
            />

            <DeleteModal
                visible={showDisableConfirm}
                title="Disable Security?"
                description="Your app will no longer be protected by a passcode or biometrics."
                actionLabel="Disable"
                onCancel={() => setShowDisableConfirm(false)}
                onDelete={confirmDisableLock}
            />

            <AlertModal
                visible={alertConfig?.visible || false}
                title={alertConfig?.title || ''}
                description={alertConfig?.description || ''}
                type={alertConfig?.type}
                onClose={() => setAlertConfig(null)}
            />
        </ThemedView>
    );
}

/**
 * A row in a settings card.
 *
 * The title sits next to the icon and the description sits underneath it,
 * lined up with the title rather than with the icon.
 */
function SettingRow({
    label,
    description,
    icon,
    children,
}: {
    label: string;
    description: string;
    icon: React.ReactNode;
    children?: React.ReactNode;
}) {
    return (
        <View style={styles.settingRow}>
            <View style={styles.settingInfo}>
                <View style={styles.settingTitleGroup}>
                    {icon}
                    <ThemedText style={styles.settingLabel}>{label}</ThemedText>
                </View>
                <ThemedText type="secondary" style={styles.settingDesc}>
                    {description}
                </ThemedText>
            </View>
            {children}
        </View>
    );
}

function Separator() {
    const { colors } = useAppTheme();
    return <View style={[styles.separator, { backgroundColor: colors.border }]} />;
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    scrollContent: {
        padding: 20,
    },
    section: {
        marginBottom: 32,
    },
    card: {
        overflow: 'hidden',
    },
    rowPress: {
        width: '100%',
    },
    separator: {
        height: StyleSheet.hairlineWidth,
        marginHorizontal: 16,
        opacity: 0.2,
    },
    settingRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    settingInfo: {
        flex: 1,
        marginRight: 16,
    },
    settingTitleGroup: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 4,
    },
    settingLabel: {
        fontSize: 16,
        lineHeight: 21,
        fontFamily: Typography.fontFamily.bold,
        marginLeft: 12,
    },
    settingDesc: {
        fontSize: 13,
        lineHeight: 18,
        fontFamily: Typography.fontFamily.medium,
        marginLeft: 32,
    },
    rowValue: {
        fontSize: 14,
        lineHeight: 20,
        fontFamily: Typography.fontFamily.medium,
    },
    buttonStack: {
        marginTop: -8,
        gap: 12,
    },
    pinContainer: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingBottom: 24,
    },
    pinHeader: {
        minHeight: 44,
        justifyContent: 'center',
    },
    pinHint: {
        fontSize: 14.5,
        lineHeight: 21,
        fontFamily: Typography.fontFamily.regular,
        textAlign: 'center',
    },
});
