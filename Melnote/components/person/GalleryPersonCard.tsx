import React, { memo } from 'react';
import { View, StyleSheet, Image } from 'react-native';
import { ThemedText } from '../ui/ThemedText';
import { DesignSystem } from '../../constants/DesignSystem';
import { LinearGradient } from 'expo-linear-gradient';
import { ScalePressable } from '../ui/ScalePressable';
import { Person } from '../../db/repositories/PersonRepository';
import { useAppTheme } from '../../hooks/useAppTheme';
import { PushPin } from '@/components/ui/Icon';
import { Typography } from '../../constants/Typography';

interface GalleryPersonCardProps {
    person: Person;
    colors: any;
    onPress: () => void;
    onLongPress?: () => void;
    /** Cards per row. Tiles shrink on 3 columns, so type and spacing scale with them. */
    columns?: number;
}

interface CardMetrics {
    radius: number;
    pad: number;
    nameSize: number;
    pitchSize: number;
    initialSize: number;
    initialPadding: number;
    pinSize: number;
    pinPad: number;
    aspectRatio: number;
    pitchGap: number;
}

const getMetrics = (columns: number): CardMetrics => {
    if (columns >= 3) {
        return {
            radius: 18,
            pad: 11,
            nameSize: 13,
            pitchSize: 10,
            initialSize: 30,
            initialPadding: 28,
            pinSize: 13,
            pinPad: 4,
            aspectRatio: 0.72,
            pitchGap: -2,
        };
    }
    return {
        radius: 22,
        pad: 14,
        nameSize: 15,
        pitchSize: 11,
        initialSize: 40,
        initialPadding: 40,
        pinSize: 14,
        pinPad: 6,
        aspectRatio: 0.85,
        pitchGap: -3,
    };
};

export const GalleryPersonCard = memo(({ person, colors, onPress, onLongPress, columns = 2 }: GalleryPersonCardProps) => {
    const { theme } = useAppTheme();
    const initials = (person.name || '?').substring(0, 1).toUpperCase();
    const metrics = getMetrics(columns);
    // A one-line pitch is dropped only when the person has none.
    const showPitch = !!person.elevatorPitch;

    // Original gradient logic from Avatar for consistency
    const getGradientColors = (str: string) => {
        const palettes = [
            ['#dc2626', '#991b1b'], ['#ea580c', '#9a3412'], ['#d97706', '#92400e'],
            ['#65a30d', '#3f6212'], ['#059669', '#065f46'], ['#0891b2', '#155e75'],
            ['#2563eb', '#1e40af'], ['#4f46e5', '#3730a3'], ['#7c3aed', '#5b21b6'],
            ['#c026d3', '#86198f'], ['#e11d48', '#9f1239'], ['#475569', '#1e293b'],
        ];
        let hash = 0;
        for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
        return palettes[Math.abs(hash) % palettes.length];
    };
    const gradientColors = getGradientColors(person.name || '?');

    const textContainerStyle = [
        styles.textContainer,
        { bottom: metrics.pad, left: metrics.pad, right: metrics.pad },
    ];
    const nameStyle = [
        styles.nameOverlay,
        // ThemedText's default 24px line box would push the pitch away, so both
        // lines get a tight box and the pair reads as one label.
        { fontSize: metrics.nameSize, lineHeight: Math.round(metrics.nameSize * 1.3) },
    ];
    const pitchStyle = [
        styles.pitchOverlay,
        {
            fontSize: metrics.pitchSize,
            lineHeight: Math.round(metrics.pitchSize * 1.3),
            marginTop: metrics.pitchGap,
        },
    ];
    const pinStyle = [
        styles.pinBadge,
        { top: metrics.pad - 4, right: metrics.pad - 4, padding: metrics.pinPad },
    ];

    return (
        <ScalePressable
            onPress={onPress}
            onLongPress={onLongPress}
            style={[
                styles.container,
                {
                    backgroundColor: colors.surface,
                    borderWidth: 0,
                    borderRadius: metrics.radius,
                    aspectRatio: metrics.aspectRatio,
                }
            ]}
            innerStyle={{ borderRadius: metrics.radius }}
        >
            {person.avatarUri ? (
                <>
                    <Image
                        source={{ uri: person.avatarUri }}
                        style={StyleSheet.absoluteFill}
                        resizeMode="cover"
                    />
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.82)']}
                        style={StyleSheet.absoluteFill}
                        locations={[0.4, 0.68, 1]}
                    />
                    <View style={textContainerStyle}>
                        <ThemedText style={nameStyle} numberOfLines={1}>{person.name}</ThemedText>
                        {showPitch && (
                            <ThemedText style={pitchStyle} numberOfLines={1}>
                                {person.elevatorPitch}
                            </ThemedText>
                        )}
                    </View>
                    {person.isPinned && (
                        <View style={[pinStyle, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                            <PushPin size={metrics.pinSize} color="#fff" weight="fill" />
                        </View>
                    )}
                </>
            ) : (
                // No avatar: use full-card colorful gradient
                <View style={styles.fallbackContainer}>
                    <LinearGradient
                        colors={gradientColors as [string, string]}
                        style={StyleSheet.absoluteFill}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                    />
                    <LinearGradient
                        colors={['transparent', 'rgba(0,0,0,0.2)', 'rgba(0,0,0,0.6)']}
                        style={StyleSheet.absoluteFill}
                        locations={[0.3, 0.6, 1]}
                    />

                    <View style={[styles.fallbackInitialWrapper, { paddingBottom: metrics.initialPadding }]}>
                        <ThemedText style={[styles.fallbackInitial, { fontSize: metrics.initialSize, lineHeight: metrics.initialSize * 1.5 }]}>
                            {initials}
                        </ThemedText>
                    </View>

                    <View style={textContainerStyle}>
                        <ThemedText style={nameStyle} numberOfLines={1}>
                            {person.name}
                        </ThemedText>
                        {showPitch && (
                            <ThemedText style={pitchStyle} numberOfLines={1}>
                                {person.elevatorPitch}
                            </ThemedText>
                        )}
                    </View>

                    {person.isPinned && (
                        <View style={[pinStyle, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
                            <PushPin size={metrics.pinSize} color="#fff" weight="fill" />
                        </View>
                    )}
                </View>
            )}
        </ScalePressable>
    );
});

const styles = StyleSheet.create({
    container: {
        width: '100%',
        aspectRatio: 0.85,
        borderRadius: 22,
        overflow: 'hidden',
        ...DesignSystem.shadows.md,
    },
    textContainer: {
        position: 'absolute',
        bottom: 14,
        left: 14,
        right: 14,
    },
    nameOverlay: {
        color: '#fff',
        fontSize: 15,
        fontWeight: '800',
        textShadowColor: 'rgba(0,0,0,0.4)',
        textShadowOffset: { width: 0, height: 1 },
        textShadowRadius: 4,
    },
    pitchOverlay: {
        color: 'rgba(255,255,255,0.75)',
        fontSize: 11,
        fontWeight: '600',
        marginTop: -6,
    },
    fallbackContainer: {
        ...StyleSheet.absoluteFill,
        justifyContent: 'center',
        alignItems: 'center',
        gap: 0,
    },
    fallbackInitialWrapper: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingBottom: 40,
    },
    fallbackInitial: {
        fontSize: 40,
        fontFamily: Typography.fontFamily.serif,
        color: '#ffffff',
        opacity: 0.85,
        lineHeight: 60,
        includeFontPadding: false,
    },
    pinBadge: {
        position: 'absolute',
        top: 10,
        right: 10,
        padding: 6,
        borderRadius: 12,
    },
});
