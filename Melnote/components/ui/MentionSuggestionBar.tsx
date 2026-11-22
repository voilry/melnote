import React, { useEffect, useRef } from 'react';
import { View, ScrollView, Text as RNText, StyleSheet } from 'react-native';
import { ThemedText } from './ThemedText';
import { Avatar } from './Avatar';
import { ScalePressable } from './ScalePressable';
import { useAppTheme } from '../../hooks/useAppTheme';
import { Typography } from '../../constants/Typography';

/**
 * Picking a chip closes the bar (the caret's @query goes away), so the chip
 * used to unmount inside the same press it started: the press-in scale and the
 * overlay never had a frame to appear, which read as "no tap feedback". Hold
 * the pick just past the press animation so the chip visibly reacts.
 */
const PICK_DELAY_MS = 110;

export interface MentionPerson {
    id: number;
    name: string;
    avatarUri?: string | null;
}

interface MentionSuggestionBarProps {
    /** Current @query typed after the caret ('' means just '@' was typed). */
    query: string;
    persons: MentionPerson[];
    /**
     * Activity-ranked connections (most-tagged / most-reminded first).
     * Shown for a BARE '@' so an empty query never materializes the whole
     * directory — just the handful of people that matter most.
     */
    topPersons?: MentionPerson[];
    onPick: (person: MentionPerson) => void;
}

/**
 * Horizontal chip list shown above the keyboard/toolbar while the user is
 * composing an @mention in the journal body. Filtered live by the query the
 * webview streams up.
 */
export function MentionSuggestionBar({ query, persons, topPersons, onPick }: MentionSuggestionBarProps) {
    const { colors } = useAppTheme();

    const q = query.trim().toLowerCase();
    const matches = (q
        ? persons.filter(p => p.name.toLowerCase().includes(q))
            .sort((a, b) => {
                const aStarts = a.name.toLowerCase().startsWith(q) ? 0 : 1;
                const bStarts = b.name.toLowerCase().startsWith(q) ? 0 : 1;
                return aStarts - bStarts || a.name.localeCompare(b.name);
            })
        : (topPersons || []).slice()
    ).slice(0, 6);

    // Deferred single-shot pick. The timer is cleared if the bar closes (the
    // user deletes the '@') before it fires, so a queued pick can never insert
    // a mention into a caret that no longer has one.
    const pickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => () => {
        if (pickTimerRef.current) clearTimeout(pickTimerRef.current);
    }, []);

    const handlePick = (person: MentionPerson) => {
        // Ignore extra taps while the press animation is playing.
        if (pickTimerRef.current) return;
        pickTimerRef.current = setTimeout(() => {
            pickTimerRef.current = null;
            onPick(person);
        }, PICK_DELAY_MS);
    };

    if (matches.length === 0) return null;

    return (
        <View style={[styles.bar, { backgroundColor: colors.background, borderTopColor: colors.border + '30' }]}>
            <ThemedText type="tiny" style={[styles.hint, { color: colors.secondary }]}>@mention</ThemedText>
            <ScrollView horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
                {matches.map(p => (
                    <ScalePressable
                        key={p.id}
                        onPress={() => handlePick(p)}
                        scaleTo={0.94}
                        style={[styles.chip, { backgroundColor: colors.surface }]}
                        innerStyle={{ borderRadius: 16 }}
                        accessibilityLabel={`Mention ${p.name}`}
                        accessibilityRole="button"
                    >
                        <Avatar name={p.name} uri={p.avatarUri} size={24} />
                        <RNText numberOfLines={1} style={[styles.chipText, { color: colors.text }]}>{p.name}</RNText>
                    </ScalePressable>
                ))}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    bar: {
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: 6,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingRight: 8,
    },
    chip: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderRadius: 16,
        maxWidth: 170,
    },
    chipText: {
        fontSize: 13,
        fontWeight: '600',
        fontFamily: Typography.fontFamily.semibold,
    },
    hint: {
        marginBottom: 6,
        marginLeft: 2,
        opacity: 0.6,
    },
});
