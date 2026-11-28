import React, { useState, useRef } from 'react';
import { View, StyleSheet, ScrollView, Platform, Linking } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { ThemedView } from '../components/ui/ThemedView';
import { ThemedText } from '../components/ui/ThemedText';
import { useSettings, ThemeMode } from '../store/SettingsContext';
import { DesignSystem } from '../constants/DesignSystem';
import { Typography } from '../constants/Typography';
import { CaretRight, Moon, Sun, Desktop as Monitor, Waveform, Trash, Bug, ShieldCheck, Heart, ShareNetwork as Share2, ArrowSquareOut as ExternalLink, DownloadSimple as Download, Bell, ListMagnifyingGlass as ListFilter, PaintBrush, Book, FileText, LockKey, Calendar, CircleHalf, Mosaic } from '@/components/ui/Icon';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import * as Haptics from 'expo-haptics';
import { DataRepository } from '../db/repositories/DataRepository';
import {
    closeBackup,
    createBackup,
    openBackup,
    restoreBackup,
    saveBackupToFolder,
    type BackupSession,
    type BackupSummary,
} from '../utils/backup';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAppTheme } from '../hooks/useAppTheme';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { DeleteModal } from '../components/ui/DeleteModal';
import { ScreenHeader } from '../components/ui/ScreenHeader';
import { Toggle } from '../components/ui/Toggle';
import { ExpBadge } from '../components/ui/ExpBadge';
import { AlertModal } from '../components/ui/AlertModal';
import { ScalePressable } from '../components/ui/ScalePressable';
import { APP_VERSION } from '../constants/Version';
import { buildBugReport, buildBugReportMailto, type BugReport } from '../utils/errorLog';
import { runExternalActivity } from '../utils/externalActivity';
import { BugReportModal } from '../components/ui/BugReportModal';

// TODO: replace with the address that should receive bug reports.
const BUG_REPORT_EMAIL = 'voileetdev@gmail.com';

export default function SettingsScreen() {
    const { settings, updateSetting, resetSettings, refreshApp, reloadSettings } = useSettings();
    const { colors, theme, hapticsEnabled } = useAppTheme();
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const [showClearData, setShowClearData] = useState(false);
    const [showResetSettings, setShowResetSettings] = useState(false);
    const [importedDataToRestore, setImportedDataToRestore] = useState<BackupSession | null>(null);
    // The Android folder picker only allows one permission request at a time,
    // so a second tap while the first one is open has to be ignored.
    const exportingRef = useRef(false);
    const importingRef = useRef(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isImporting, setIsImporting] = useState(false);
    const [alertConfig, setAlertConfig] = useState<{ visible: boolean, title: string, description: string, type: 'success' | 'error' | 'info' | 'warning', onClose?: () => void } | null>(null);
    // The bug report is previewed before the email opens, so the user sees
    // exactly what would be sent. The same snapshot is then used for the
    // email, so the preview and the mail can never disagree.
    const [showBugReport, setShowBugReport] = useState(false);
    const [bugReport, setBugReport] = useState<BugReport | null>(null);


    const showAlert = (title: string, description: string, type: 'success' | 'error' | 'info' | 'warning' = 'info', onClose?: () => void) => {
        setAlertConfig({ visible: true, title, description, type, onClose });
    };

    const triggerHaptic = (style = Haptics.ImpactFeedbackStyle.Light) => {
        if (hapticsEnabled && Platform.OS !== 'web') {
            Haptics.impactAsync(style);
        }
    };

    const handleThemeChange = (mode: ThemeMode) => {
        triggerHaptic();
        updateSetting('theme', mode);
    };

    const handleExportData = async () => {
        // The native permission request rejects with "You have an unfinished
        // permission request" when it is started while another one is still
        // pending, so overlapping taps are ignored instead of failing.
        if (exportingRef.current) return;
        exportingRef.current = true;
        setIsExporting(true);
        try {
            triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);

            if (Platform.OS === 'web') {
                showAlert(
                    "Not available here",
                    "Backup export is available on Android and iOS.",
                    "info"
                );
                return;
            }

            const backup = await createBackup();
            const summary = backupSummaryText(backup);

            if (Platform.OS === 'android') {
                const SAF = (FileSystem as any).StorageAccessFramework;
                if (SAF) {
                    let initialUri: string | null = null;
                    try {
                        initialUri = SAF.getUriForDirectoryInRoot('Documents');
                    } catch (e) {
                        // ignore and open default
                    }

                    const permissions = await SAF.requestDirectoryPermissionsAsync(initialUri);
                    if (!permissions.granted) {
                        showAlert("Permission Denied", "Could not save without folder access.", "error");
                        return;
                    }

                    try {
                        // The archive is copied into the folder natively, so even
                        // a large backup never travels through JS memory.
                        await saveBackupToFolder(backup, permissions.directoryUri);
                    } catch (folderError: any) {
                        console.warn('Folder write error:', folderError);
                        const msg = String(folderError?.message || '');
                        if (isOutOfSpace(msg)) {
                            showAlert(
                                "Not Enough Space",
                                "There is not enough free space to save the backup. Free up some storage and try again.",
                                "error"
                            );
                        } else if (msg.includes('writable') || msg.includes('msd') || msg.includes('downloads')) {
                            showAlert(
                                "Folder Restricted",
                                "Android prevents saving directly into the root Downloads folder. Please select the 'Documents' folder or create a new subfolder.",
                                "error"
                            );
                        } else {
                            showAlert(
                                "Export Error",
                                `Could not write to the selected folder: ${folderError?.message || "Please choose another folder."}`,
                                "error"
                            );
                        }
                        return;
                    }

                    // The archive now lives in the folder the user picked.
                    await FileSystem.deleteAsync(backup.uri, { idempotent: true }).catch(() => { });
                    showAlert(
                        "Backup saved",
                        `${summary}${formatSize(backup.size) ? ` • ${formatSize(backup.size)}` : ''}\n\n${backup.missingMedia.length ? `${backup.missingMedia.length} image(s) referenced by a note were missing and are not in this backup.` : 'All images are included.'}`,
                        backup.missingMedia.length ? 'warning' : 'success'
                    );
                    return;
                }
            }

            if (await Sharing.isAvailableAsync()) {
                await Sharing.shareAsync(backup.uri, {
                    mimeType: 'application/zip',
                    dialogTitle: 'Save Melnote Backup',
                    UTI: 'public.zip-archive'
                });
                showAlert(
                    "Backup ready",
                    `${summary}${formatSize(backup.size) ? ` • ${formatSize(backup.size)}` : ''}\n\n${backup.missingMedia.length ? `${backup.missingMedia.length} image(s) referenced by a note were missing and are not in this backup.` : 'All images are included.'}`,
                    backup.missingMedia.length ? 'warning' : 'success'
                );
            } else {
                showAlert("Export Error", "Sharing is not available on this device.", "error");
            }
        } catch (error: any) {
            console.error('Export error:', error);
            showAlert("Export Failed", `There was an error generating your backup file: ${error?.message || "Please try again."}`, "error");
        } finally {
            exportingRef.current = false;
            setIsExporting(false);
        }
    };

    const handleImportData = async () => {
        // The document picker cannot be opened twice at the same time.
        if (importingRef.current) return;
        importingRef.current = true;
        setIsImporting(true);
        try {
            // The system file picker takes the app off the screen. Announcing
            // it stops the app lock from springing up on the way back.
            const result = await runExternalActivity(() => DocumentPicker.getDocumentAsync({
                type: '*/*',
                copyToCacheDirectory: true
            }));

            if (result.canceled) return;

            const session = await openBackup(result.assets[0].uri);
            triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
            setImportedDataToRestore(session);
        } catch (error: any) {
            if (isOutOfSpace(String(error?.message || ''))) {
                showAlert(
                    "Not Enough Space",
                    "There is not enough free space to read the backup. Free up some storage and try again.",
                    "error"
                );
                return;
            }
            showAlert("Import Failed", error?.message || "Could not read the backup file.", "error");
        } finally {
            importingRef.current = false;
            setIsImporting(false);
        }
    };

    const confirmRestoreBackup = async () => {
        const session = importedDataToRestore;
        if (!session) return;
        try {
            const summary = await restoreBackup(session);
            await reloadSettings();
            triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
            showAlert("Success", `Your data has been restored.\n\n${backupSummaryText(summary)}`, "success", () => {
                router.dismissAll();
                setTimeout(() => refreshApp(), 350);
            });
        } catch (e: any) {
            console.error('Full import error:', e);
            if (isOutOfSpace(String(e?.message || ''))) {
                showAlert(
                    "Not Enough Space",
                    "There is not enough free space to restore the backup. Your current data is unchanged - free up some storage and try again.",
                    "error"
                );
            } else {
                showAlert("Import Error", `Failed to restore: ${e.message || "Unknown error"}`, "error");
            }
        } finally {
            setImportedDataToRestore(null);
        }
    };

    const handleClearData = () => {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Heavy);
        setShowClearData(true);
    };

    const confirmClearData = async () => {
        triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
        try {
            await DataRepository.clearAllData();
            setShowClearData(false);
            showAlert("Registry Wiped", "Your network has been cleared.", "success", () => {
                router.dismissAll();
                setTimeout(() => refreshApp(), 350);
            });
        } catch (error: any) {
            // Without this the sheet would stay open with no feedback and the
            // user would reasonably assume the wipe happened.
            console.error('Failed to clear data:', error);
            setShowClearData(false);
            showAlert(
                "Could Not Clear Data",
                error?.message || "Something went wrong while clearing your data. Nothing was removed.",
                "error"
            );
        }
    };

    const openLink = (url: string) => {
        triggerHaptic();
        Linking.openURL(url).catch(() => {
            showAlert("Link Error", "Could not open external browser.", "error");
        });
    };

    const handleReportBug = () => {
        triggerHaptic();
        // Build the report once: the preview and the email both use it.
        let report: BugReport = {
            subject: 'Melnote bug report',
            body: 'The error log could not be read on this device.',
            errorCount: 0,
        };
        try {
            report = buildBugReport();
        } catch (error) {
            console.warn('Could not build the bug report preview:', error);
        }
        setBugReport(report);
        setShowBugReport(true);
    };

    const handleSendBugReport = async () => {
        setShowBugReport(false);
        try {
            // Same address, same contents as the preview. Nothing is sent
            // until the user sends the email themselves.
            const url = buildBugReportMailto(BUG_REPORT_EMAIL, bugReport || undefined);
            await Linking.openURL(url);
        } catch (error) {
            console.warn('Could not open the email app:', error);
            // The preview modal is being torn down here. Two Modal windows
            // open at once are unreliable on Android, so wait for it to be
            // gone before showing the alert.
            setTimeout(() => {
                showAlert(
                    "No Email App",
                    "Melnote could not open an email app. Install one, then try again.",
                    "error"
                );
            }, 380);
        }
    };

    return (
        <ThemedView style={styles.container}>
            <Stack.Screen options={{ headerShown: false }} />

            <ScreenHeader
                title="Settings"
                onBack={() => router.back()}
            />

            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + 40 }]}>
                <View style={[styles.themeCardsGrid, { marginBottom: 20 }]}>
                    <ThemeCard
                        label="System"
                        active={settings.theme === 'auto'}
                        onPress={() => handleThemeChange('auto')}
                        icon={Monitor}
                        colors={colors}
                        theme={theme}
                    />
                    <ThemeCard
                        label="Light"
                        active={settings.theme === 'light'}
                        onPress={() => handleThemeChange('light')}
                        icon={Sun}
                        colors={colors}
                        theme={theme}
                    />
                    <ThemeCard
                        label="Dark"
                        active={settings.theme === 'dark'}
                        onPress={() => handleThemeChange('dark')}
                        icon={Moon}
                        colors={colors}
                        theme={theme}
                    />
                </View>

                <ScalePressable
                    onPress={() => {
                        triggerHaptic();
                        router.push('/settings/appearance');
                    }}
                    scaleTo={0.97}
                    style={{ width: '100%', marginBottom: theme === 'dark' ? 8 : 32 }}
                    innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                >
                    <Card style={styles.card} padding="none">
                        <MenuOption
                            label="Appearance"
                            icon={<PaintBrush size={24} color={colors.tint} weight="duotone" />}
                            colors={colors}
                            rightIcon={<CaretRight size={16} color={colors.icon} />}
                            noBackground
                        />
                    </Card>
                </ScalePressable>

                {theme === 'dark' && (
                    <Card style={[styles.card, { marginBottom: 32 }]} padding="none">
                        <SettingRow
                            label={
                                <ThemedText style={styles.settingLabel}>
                                    A<ThemedText style={[styles.settingLabel, { fontVariant: ['small-caps'], fontSize: 14 }]}>moled</ThemedText> Mode
                                </ThemedText>
                            }
                            icon={<CircleHalf size={20} color={colors.tint} weight="duotone" />}
                            colors={colors}
                            style={[styles.paddingBox, { paddingVertical: 23 }]}
                        >
                            <Toggle
                                value={settings.amoledEnabled}
                                onValueChange={(v) => {
                                    triggerHaptic();
                                    updateSetting('amoledEnabled', v);
                                }}
                            />
                        </SettingRow>
                    </Card>
                )}

                <Section title="App Dynamics">
                    <Card style={[styles.card, { marginBottom: 12 }]} padding="none">
                        <View style={styles.paddingBox}>
                            <SettingRow
                                label="Default People Sort"
                                icon={<ListFilter size={20} color={colors.tint} />}
                                colors={colors}
                            />
                            <View style={styles.strengthOptions}>
                                {[
                                    { label: 'Name (A-Z)', value: 'name' },
                                    { label: 'Newest First', value: 'newest' },
                                    { label: 'Oldest First', value: 'oldest' }
                                ].map((opt) => (
                                    <View key={opt.label} style={styles.strengthButtonWrapper}>
                                        <ScalePressable
                                            onPress={() => {
                                                triggerHaptic();
                                                updateSetting('defaultSort', opt.value as any);
                                            }}
                                            style={[
                                                styles.strengthButton,
                                                {
                                                    backgroundColor: settings.defaultSort === opt.value ? colors.tint + '15' : colors.surface,
                                                    borderColor: settings.defaultSort === opt.value ? colors.tint + '60' : 'transparent',
                                                    borderWidth: 1
                                                }
                                            ]}
                                        >
                                            <ThemedText type="tiny" style={{ color: settings.defaultSort === opt.value ? colors.tint : colors.secondary, fontFamily: Typography.fontFamily.extrabold }}>
                                                {opt.label}
                                            </ThemedText>
                                        </ScalePressable>
                                    </View>
                                ))}
                            </View>
                        </View>
                    </Card>

                    <Card style={[styles.card, { marginTop: 12 }]} padding="none">
                        <SettingRow
                            label="Haptic Response"
                            icon={<Waveform size={20} color={colors.tint} />}
                            colors={colors}
                            style={[styles.paddingBox, { paddingVertical: 18, paddingBottom: 20, paddingTop: 20 }]}
                        >
                            <Toggle
                                value={settings.hapticsEnabled}
                                onValueChange={(v) => {
                                    triggerHaptic();
                                    updateSetting('hapticsEnabled', v);
                                }}
                            />
                        </SettingRow>
                        <View style={[styles.separator, { backgroundColor: colors.border }]} />
                        <SettingRow
                            label="Notifications"
                            icon={<Bell size={20} color={colors.tint} weight="duotone" />}
                            colors={colors}
                            style={[styles.paddingBox, { paddingVertical: 18, paddingBottom: 20, paddingTop: 20 }]}
                        >
                            <Toggle
                                value={settings.enableReminders}
                                onValueChange={(v) => {
                                    triggerHaptic();
                                    updateSetting('enableReminders', v);
                                }}
                            />
                        </SettingRow>
                        <View style={[styles.separator, { backgroundColor: colors.border }]} />
                        <SettingRow
                            label="Journal"
                            icon={<Book size={20} color={colors.tint} weight="duotone" />}
                            colors={colors}
                            style={[styles.paddingBox, { paddingVertical: 18, paddingBottom: 20, paddingTop: 20 }]}
                        >
                            <Toggle
                                value={settings.showJournalTab}
                                onValueChange={(v) => {
                                    triggerHaptic();
                                    updateSetting('showJournalTab', v);
                                }}
                            />
                        </SettingRow>
                        <View style={[styles.separator, { backgroundColor: colors.border }]} />
                        <SettingRow
                            label="Calendar"
                            icon={<Calendar size={20} color={colors.tint} weight="duotone" />}
                            colors={colors}
                            style={[styles.paddingBox, { paddingVertical: 18, paddingBottom: 20, paddingTop: 20 }]}
                        >
                            <Toggle
                                value={settings.showCalendarTab}
                                onValueChange={(v) => {
                                    triggerHaptic();
                                    updateSetting('showCalendarTab', v);
                                }}
                            />
                        </SettingRow>

                    </Card>

                    <ScalePressable
                        onPress={() => {
                            triggerHaptic();
                            router.push('/settings/extra');
                        }}
                        scaleTo={0.97}
                        style={{ width: '100%', marginTop: 12 }}
                        innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                    >
                        <Card style={styles.card} padding="none">
                            <MenuOption
                                label="Extra"
                                icon={<Mosaic size={24} color={colors.tint} weight="duotone" />}
                                colors={colors}
                                rightIcon={<CaretRight size={16} color={colors.icon} />}
                                noBackground
                            />
                        </Card>
                    </ScalePressable>
                </Section>

                <Section title="Privacy & Security">
                    <ScalePressable
                        onPress={() => {
                            triggerHaptic();
                            router.push('/settings/privacy');
                        }}
                        scaleTo={0.97}
                        style={{ width: '100%', marginBottom: 32 }}
                        innerStyle={{ borderRadius: DesignSystem.radius.lg }}
                    >
                        <Card style={styles.card} padding="none">
                            <MenuOption
                                label="App Lock"
                                icon={<LockKey size={24} color={colors.tint} weight="duotone" />}
                                colors={colors}
                                rightIcon={<CaretRight size={16} color={colors.icon} />}
                                noBackground
                                badge={<ExpBadge />}
                            />
                        </Card>
                    </ScalePressable>
                </Section>

                <Section title="Data Management">
                    <Card style={styles.card} padding="none">
                        <MenuOption
                            label="Export Data"
                            icon={<Share2 size={20} color={colors.secondary} />}
                            onPress={handleExportData}
                            disabled={isExporting}
                            colors={colors}
                        />
                        <MenuOption
                            label="Import Data"
                            icon={<Download size={20} color={colors.secondary} />}
                            onPress={handleImportData}
                            disabled={isImporting}
                            colors={colors}
                        />
                        <MenuOption
                            label="Delete All Data"
                            icon={<Trash size={20} color={colors.error} />}
                            onPress={handleClearData}
                            colors={colors}
                            isDestructive
                        />
                    </Card>
                </Section>

                <Section title="About App">
                    <Card style={styles.card} padding="none">
                        <MenuOption
                            label="Privacy Policy"
                            icon={<ShieldCheck size={20} color={colors.secondary} />}
                            onPress={() => openLink('https://sites.google.com/view/melnote/privacy-policy')}
                            colors={colors}
                            rightIcon={<ExternalLink size={14} color={colors.icon} />}
                        />
                        <MenuOption
                            label="Terms of Service"
                            icon={<FileText size={20} color={colors.secondary} />}
                            onPress={() => openLink('https://sites.google.com/view/melnote/terms-of-service')}
                            colors={colors}
                            rightIcon={<ExternalLink size={14} color={colors.icon} />}
                        />
                        <MenuOption
                            label="Report a bug"
                            icon={<Bug size={20} color={colors.secondary} />}
                            onPress={handleReportBug}
                            colors={colors}
                        />
                        <View style={styles.infoRow}>
                            <Heart size={16} color={colors.error} weight="fill" />
                            <View style={{ marginLeft: 16 }}>
                                <ThemedText type="sectionHeader" style={{ fontSize: 14, marginBottom: -4 }}>Melnote v{APP_VERSION} beta</ThemedText>
                                <ThemedText type="tiny" style={{ color: colors.secondary, marginTop: 1 }}>Build with love by zash</ThemedText>
                            </View>
                        </View>
                    </Card>
                </Section>

                <Button
                    title="Restore Factory Settings"
                    variant="ghost"
                    onPress={() => {
                        triggerHaptic(Haptics.ImpactFeedbackStyle.Light);
                        setShowResetSettings(true);
                    }}
                    style={{ marginTop: 20, marginBottom: 20 }}
                />
            </ScrollView>

            <DeleteModal
                visible={showClearData}
                title="Wipe All Data"
                description="This will permanently delete every person, journal entry, and location you've ever created. This is irreversible."
                onCancel={() => setShowClearData(false)}
                onDelete={confirmClearData}
            />

            <DeleteModal
                visible={showResetSettings}
                title="Reset Settings"
                description="Restore UI and Dynamics to defaults?"
                onCancel={() => setShowResetSettings(false)}
                onDelete={() => {
                    triggerHaptic(Haptics.ImpactFeedbackStyle.Medium);
                    resetSettings();
                    setShowResetSettings(false);
                }}
            />
            <DeleteModal
                visible={!!importedDataToRestore}
                title="Restore Data"
                description={
                    importedDataToRestore
                        ? `${backupSummaryText(importedDataToRestore.summary)}\n\nThis will replace all your current contacts, notes and images with the data from the backup file. This cannot be undone.`
                        : ''
                }
                onCancel={() => {
                    void closeBackup(importedDataToRestore);
                    setImportedDataToRestore(null);
                }}
                onDelete={confirmRestoreBackup}
                actionLabel="Restore"
                actionColor={colors.tint}
                actionTextColor={theme === 'dark' ? '#000' : '#fff'}
            />

            <AlertModal
                visible={alertConfig?.visible || false}
                title={alertConfig?.title || ''}
                description={alertConfig?.description || ''}
                type={alertConfig?.type}
                onClose={() => {
                    const cb = alertConfig?.onClose;
                    setAlertConfig(null);
                    if (cb) cb();
                }}
            />

            <BugReportModal
                visible={showBugReport}
                reportBody={bugReport?.body || ''}
                errorCount={bugReport?.errorCount || 0}
                onClose={() => setShowBugReport(false)}
                onReport={handleSendBugReport}
            />
        </ThemedView>
    );
}

function Section({ title, children }: { title: string, children: React.ReactNode }) {
    return (
        <View style={styles.section}>
            <ThemedText type="sectionHeader" style={styles.sectionTitle}>{title}</ThemedText>
            {children}
        </View>
    );
}

function SettingRow({ label, description, icon, children, colors, style }: any) {
    return (
        <View style={[styles.settingRow, !description && { paddingVertical: 12 }, style]}>
            <View style={styles.settingInfo}>
                <View style={[styles.settingTitleGroup, !description && { marginBottom: 0 }]}>
                    {icon}
                    <ThemedText style={styles.settingLabel}>{label}</ThemedText>
                </View>
                {description ? (
                    <ThemedText style={[styles.settingDesc, { color: colors.secondary }]}>{description}</ThemedText>
                ) : null}
            </View>
            {children}
        </View>
    );
}

function MenuOption({ label, description, icon, onPress, colors, isDestructive, rightIcon, noBackground, borderRadius, scale = true, badge, disabled }: any) {
    const content = (
        <View style={[styles.optionRow, !description && { paddingVertical: 12 }, disabled && { opacity: 0.4 }]}>
            <View style={styles.optionLabelGroup}>
                {icon && (
                    <View style={[
                        styles.menuIconContainer,
                        { backgroundColor: noBackground ? 'transparent' : colors.surface },
                        noBackground && { width: 32, alignItems: 'flex-start' }
                    ]}>
                        {icon}
                    </View>
                )}
                <View style={{ marginLeft: icon ? (noBackground ? 8 : 16) : 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <ThemedText style={[styles.optionLabel, isDestructive && { color: colors.error }]}>{label}</ThemedText>
                        {badge}
                    </View>
                    {description ? <ThemedText type="tiny" style={{ color: colors.secondary, marginTop: 2 }}>{description}</ThemedText> : null}
                </View>
            </View>
            {rightIcon}
        </View>
    );

    if (!onPress || disabled) return content;

    return (
        <ScalePressable
            onPress={onPress}
            innerStyle={{ borderRadius: borderRadius || DesignSystem.radius.sm }}
            scale={scale}
            scaleTo={0.96}
            accessibilityRole="button"
            accessibilityLabel={description ? `${label}. ${description}` : label}
        >
            {content}
        </ScalePressable>
    );
}

function ThemeCard({ label, active, onPress, icon: Icon, colors, theme }: any) {
    const bg = active
        ? (theme === 'dark' ? 'rgba(255,255,255,0.12)' : colors.tint + '15')
        : (theme === 'dark' ? 'rgba(255,255,255,0.06)' : colors.surface);

    return (
        <ScalePressable
            onPress={onPress}
            style={[
                styles.themeCard,
                {
                    backgroundColor: bg,
                    borderColor: 'transparent',
                }
            ]}
            innerStyle={{ borderRadius: 24 }}
            scale={true}
        >
            <View style={styles.themeCardMain}>
                <Icon
                    color={active ? colors.tint : (theme === 'dark' ? 'rgba(255,255,255,0.45)' : colors.icon)}
                    weight={active ? 'fill' : 'regular'}
                    size={32}
                />
            </View>
            <ThemedText style={[styles.themeCardLabel, { color: active ? colors.text : colors.secondary, marginTop: 12 }]}>
                {label}
            </ThemedText>
        </ScalePressable>
    );
}

/** One-line description of what a backup holds, used in alerts and the confirm sheet. */
function backupSummaryText(summary: BackupSummary): string {
    const parts: string[] = [];
    if (summary.createdAt) {
        const date = new Date(summary.createdAt);
        const stamp = isNaN(date.getTime())
            ? summary.createdAt
            : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
        parts.push(`Backup from ${stamp}`);
    }
    parts.push(`${summary.peopleCount} people`);
    parts.push(`${summary.journalCount} journals`);
    if (summary.entryCount) parts.push(`${summary.entryCount} notes`);
    if (summary.mediaCount) parts.push(`${summary.mediaCount} images`);
    return parts.join(' • ');
}

/** Human readable file size for the export summary. */
function formatSize(bytes: number): string {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** True when a native error means the device ran out of storage. */
function isOutOfSpace(message: string): boolean {
    const msg = message.toLowerCase();
    return msg.includes('enospc')
        || msg.includes('no space left')
        || msg.includes('not enough space')
        || msg.includes('disk full');
}

const styles = StyleSheet.create({
    container: { flex: 1 },
    scrollContent: { padding: 20 },
    section: { marginBottom: 32 },
    sectionTitle: { fontSize: 18, opacity: 0.85, marginBottom: 14, marginLeft: 4 },
    card: { overflow: 'hidden' },
    paddingBox: { padding: 16 },
    optionRow: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: 16,
    },
    optionLabelGroup: { flexDirection: 'row', alignItems: 'center' },
    optionLabel: {
        fontSize: 16,
        fontFamily: Typography.fontFamily.semibold,
    },
    separator: { height: 1, marginHorizontal: 16, opacity: 0.2 },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    settingInfo: { flex: 1, marginRight: 16 },
    settingTitleGroup: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
    settingLabel: {
        fontSize: 16,
        fontFamily: Typography.fontFamily.bold,
        marginLeft: 12
    },
    settingDesc: {
        fontSize: 13,
        lineHeight: 18,
        marginLeft: 32,
        fontFamily: Typography.fontFamily.medium,
        marginTop: 2
    },
    strengthOptions: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginLeft: 32 },
    strengthButtonWrapper: { marginRight: 8, marginBottom: 8 },
    strengthButton: {
        paddingVertical: 8,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 0,
    },
    menuIconContainer: { width: 40, height: 40, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
    infoRow: { flexDirection: 'row', alignItems: 'center', padding: 20 },
    themeCardsGrid: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        paddingHorizontal: 4,
    },
    themeCard: {
        flex: 1,
        marginHorizontal: 4,
        paddingVertical: 24,
        paddingHorizontal: 8,
        alignItems: 'center',
        borderRadius: 24,
    },
    themeCardMain: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    themeCardLabel: {
        fontSize: 13,
        fontFamily: Typography.fontFamily.bold,
    },
});
