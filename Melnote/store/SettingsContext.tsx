import React, { createContext, useCallback, useContext, useState, useEffect } from 'react';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { DEFAULT_APP_LOCK_TIMEOUT_SECONDS } from '../utils/appLock';

export type ThemeMode = 'auto' | 'light' | 'dark';

interface Settings {
    theme: ThemeMode;
    hapticsEnabled: boolean;

    defaultSort: 'name' | 'newest' | 'oldest';
    enableReminders: boolean;
    showQuickArray: boolean;
    addTimestampToNotes: boolean;
    journalFontSize: number;
    journalPadding: number;
    profileBlurBackground: boolean;
    peopleTabMode: 'default' | 'discovery';
    peopleListStyle: 'list' | 'gallery';
    /** How many gallery cards sit side by side. Only used when peopleListStyle is 'gallery'. */
    peopleGalleryColumns: number;
    themePreset: string;
    editorFontSize: number;
    showJournalTab: boolean;
    showCalendarTab: boolean;
    profileTabsOrder: string[];
    appLockEnabled: boolean;
    biometricEnabled: boolean;
    /** How long the app may be away before it locks again, in seconds. */
    appLockTimeout: number;
    /** Wrong passcodes so far. Kept so restarting the app does not wipe the penalty. */
    appLockFailures: number;
    /** Until when passcode attempts are refused (epoch ms). */
    appLockLockedUntil: number;
    amoledEnabled: boolean;
    materialYouEnabled: boolean;
}

interface SettingsContextType {
    settings: Settings;
    updateSetting: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
    resetSettings: () => void;
    isLoading: boolean;
    /** Null until persisted settings have loaded, so the tour never renders on a guess. */
    hasCompletedOnboarding: boolean | null;
    completeOnboarding: () => void;
    refreshKey: number;
    refreshApp: () => void;
    /** Re-reads the persisted settings, used after a backup restore. */
    reloadSettings: () => Promise<void>;
}

const DEFAULT_SETTINGS: Settings = {
    theme: 'auto',
    hapticsEnabled: true,

    defaultSort: 'name',
    enableReminders: true,
    showQuickArray: false,
    addTimestampToNotes: true,
    journalFontSize: 16,
    journalPadding: 28,
    profileBlurBackground: false,
    peopleTabMode: 'default',
    peopleListStyle: 'list',
    peopleGalleryColumns: 2,
    themePreset: 'default',
    editorFontSize: 16,
    showJournalTab: true,
    showCalendarTab: true,
    profileTabsOrder: ['info', 'notes', 'journals', 'contacts'],
    appLockEnabled: false,
    biometricEnabled: false,
    appLockTimeout: DEFAULT_APP_LOCK_TIMEOUT_SECONDS,
    appLockFailures: 0,
    appLockLockedUntil: 0,
    amoledEnabled: true,
    materialYouEnabled: false,
};

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export function SettingsProvider({ children }: { children: React.ReactNode }) {
    const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
    const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState<boolean | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [refreshKey, setRefreshKey] = useState(0);

    const refreshApp = () => {
        setRefreshKey(prev => prev + 1);
    };

    const reloadSettings = async () => {
        await loadSettings();
    };

    useEffect(() => {
        loadSettings();
    }, []);

    const loadSettings = async () => {
        try {
            const stored = await SettingsRepository.getAll();
            const merged = { ...DEFAULT_SETTINGS };

            if (stored.theme) merged.theme = stored.theme as ThemeMode;
            if (stored.hapticsEnabled) merged.hapticsEnabled = stored.hapticsEnabled === 'true';

            // `hasCompletedOnboarding` is the durable completion marker. Fall back to
            // the legacy `showOnboarding=false` key once, so existing users are not
            // shown the tour again after upgrading.
            const completed = stored.hasCompletedOnboarding !== undefined
                ? stored.hasCompletedOnboarding === 'true'
                : stored.showOnboarding !== undefined
                    ? stored.showOnboarding === 'false'
                    : false;
            setHasCompletedOnboarding(completed);
            if (stored.hasCompletedOnboarding === undefined) {
                void SettingsRepository.set('hasCompletedOnboarding', String(completed)).catch((e) => {
                    console.error('Failed to migrate onboarding completion', e);
                });
            }

            if (stored.defaultSort) merged.defaultSort = stored.defaultSort as any;
            if (stored.enableReminders) merged.enableReminders = stored.enableReminders === 'true';
            if (stored.showQuickArray !== undefined) merged.showQuickArray = stored.showQuickArray === 'true';
            if (stored.addTimestampToNotes !== undefined) merged.addTimestampToNotes = stored.addTimestampToNotes === 'true';
            if (stored.journalFontSize !== undefined) merged.journalFontSize = parseInt(stored.journalFontSize);
            if (stored.journalPadding !== undefined) merged.journalPadding = parseInt(stored.journalPadding);
            if (stored.profileBlurBackground !== undefined) merged.profileBlurBackground = stored.profileBlurBackground === 'true';
            if (stored.peopleTabMode) merged.peopleTabMode = stored.peopleTabMode as 'default' | 'discovery';
            if (stored.peopleListStyle) merged.peopleListStyle = stored.peopleListStyle as 'list' | 'gallery';
            if (stored.peopleGalleryColumns !== undefined) {
                const columns = parseInt(stored.peopleGalleryColumns, 10);
                // Only 2 and 3 are offered; a stored 4 from an older build clamps to 3.
                merged.peopleGalleryColumns = Number.isFinite(columns) && columns >= 2
                    ? Math.min(3, columns)
                    : DEFAULT_SETTINGS.peopleGalleryColumns;
            }
            if (stored.themePreset) merged.themePreset = stored.themePreset;
            if (stored.editorFontSize !== undefined) merged.editorFontSize = parseInt(stored.editorFontSize);
            if (stored.showJournalTab !== undefined) merged.showJournalTab = stored.showJournalTab === 'true';
            if (stored.profileTabsOrder) {
                const storedOrder = stored.profileTabsOrder.split(',');
                // Ensure all default tabs are always present (e.g. if a new tab is added in a future update)
                const missingTabs = DEFAULT_SETTINGS.profileTabsOrder.filter(t => !storedOrder.includes(t));
                merged.profileTabsOrder = [...storedOrder, ...missingTabs];
            }
            if (stored.appLockEnabled !== undefined) merged.appLockEnabled = stored.appLockEnabled === 'true';
            if (stored.biometricEnabled !== undefined) merged.biometricEnabled = stored.biometricEnabled === 'true';
            if (stored.appLockTimeout !== undefined) {
                const seconds = parseInt(stored.appLockTimeout, 10);
                merged.appLockTimeout = Number.isFinite(seconds) && seconds >= 0
                    ? seconds
                    : DEFAULT_APP_LOCK_TIMEOUT_SECONDS;
            }
            if (stored.appLockFailures !== undefined) {
                const failures = parseInt(stored.appLockFailures, 10);
                merged.appLockFailures = Number.isFinite(failures) && failures > 0 ? failures : 0;
            }
            if (stored.appLockLockedUntil !== undefined) {
                const until = parseInt(stored.appLockLockedUntil, 10);
                merged.appLockLockedUntil = Number.isFinite(until) && until > 0 ? until : 0;
            }
            if (stored.showCalendarTab !== undefined) merged.showCalendarTab = stored.showCalendarTab === 'true';
            if (stored.amoledEnabled !== undefined) merged.amoledEnabled = stored.amoledEnabled === 'true';
            if (stored.materialYouEnabled !== undefined) merged.materialYouEnabled = stored.materialYouEnabled === 'true';

            setSettings(merged);
        } catch (e) {
            console.error('Failed to load settings', e);
        } finally {
            setIsLoading(false);
        }
    };

    const updateSetting = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
        setSettings(prev => {
            const next = { ...prev, [key]: value };
            SettingsRepository.set(key, value.toString());
            return next;
        });
    }, []);

    const completeOnboarding = () => {
        // Persist before dismissing. The write is synchronous under the hood, so a
        // close or background event right after finishing cannot replay the tour.
        void SettingsRepository.set('hasCompletedOnboarding', 'true').catch((e) => {
            console.error('Failed to persist onboarding completion', e);
        });
        // Keep the legacy key in sync for builds that still read it.
        void SettingsRepository.set('showOnboarding', 'false').catch((e) => {
            console.error('Failed to persist legacy onboarding state', e);
        });
        setHasCompletedOnboarding(true);
    };

    const resetSettings = () => {
        // The app lock is a security setting, not a look-and-feel one. A
        // "reset settings" must not quietly switch the lock off and leave the
        // notes unprotected, so the lock is left exactly as it is.
        setSettings(prev => ({
            ...DEFAULT_SETTINGS,
            appLockEnabled: prev.appLockEnabled,
            biometricEnabled: prev.biometricEnabled,
            appLockTimeout: prev.appLockTimeout,
            appLockFailures: prev.appLockFailures,
            appLockLockedUntil: prev.appLockLockedUntil,
        }));

        const kept = new Set<string>([
            'appLockEnabled',
            'biometricEnabled',
            'appLockTimeout',
            'appLockFailures',
            'appLockLockedUntil',
        ]);

        Object.entries(DEFAULT_SETTINGS).forEach(([key, value]) => {
            if (kept.has(key)) return;
            SettingsRepository.set(key, value.toString());
        });
    };

    return (
        <SettingsContext.Provider value={{ 
            settings, 
            updateSetting, 
            resetSettings, 
            isLoading, 
            hasCompletedOnboarding,
            completeOnboarding,
            refreshKey,
            refreshApp,
            reloadSettings
        }}>
            {children}
        </SettingsContext.Provider>
    );
}

export function useSettings() {
    const context = useContext(SettingsContext);
    if (!context) {
        throw new Error('useSettings must be used within a SettingsProvider');
    }
    return context;
}
