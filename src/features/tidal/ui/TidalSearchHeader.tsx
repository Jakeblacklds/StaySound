import type { TidalSearchHealth } from '@/src/features/tidal/hooks/useTidalMirrorHealth';
import type { TidalTab } from '@/src/features/tidal/model/tidalScreenTypes';
import { formatRecentSearchTitle } from '@/src/features/tidal/model/tidalScreenUtils';
import { tidalScreenStyles as styles } from '@/src/features/tidal/ui/tidalScreenStyles';
import { withAlpha } from '@/src/theme';
import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Searchbar, Text } from 'react-native-paper';

type SearchHeaderColors = {
    onBackground: string;
    onSurface: string;
    onSurfaceVariant: string;
    onPrimary: string;
    surfaceVariant: string;
    error: string;
};

type SearchHeaderPalette = {
    searchBackground: string;
    searchBorder: string;
    cardBorder: string;
};

type ResultTab = {
    key: TidalTab;
    label: string;
};

type TidalSearchHeaderProps = {
    accentColor: string;
    colors: SearchHeaderColors;
    palette: SearchHeaderPalette;
    query: string;
    isFocused: boolean;
    hasQuery: boolean;
    hasCommittedQuery: boolean;
    activeTab: TidalTab;
    resultTabs: ResultTab[];
    recentSearches: string[];
    searchHealth: TidalSearchHealth;
    onQueryChange: (value: string) => void;
    onFocusChange: (focused: boolean) => void;
    onSubmit: () => void;
    onOpenSettings: () => void;
    onTabChange: (tab: TidalTab) => void;
    onSuggestion: (value: string) => void;
};

export const TidalSearchHeader = memo(function TidalSearchHeader({
    accentColor,
    colors,
    palette,
    query,
    isFocused,
    hasQuery,
    hasCommittedQuery,
    activeTab,
    resultTabs,
    recentSearches,
    searchHealth: searchHealthBanner,
    onQueryChange: setQuery,
    onFocusChange,
    onSubmit: handleSubmitSearch,
    onOpenSettings,
    onTabChange: setActiveTab,
    onSuggestion: applySuggestion,
}: TidalSearchHeaderProps) {
    return (
        <>
            <View style={styles.header}>
                <View style={styles.headerTitleRow}>
                    <View style={styles.headerTitleBlock}>
                        <Text style={[styles.headerTitle, { color: colors.onBackground }]}>Buscar</Text>
                    </View>
                    <View style={styles.headerActionColumn}>
                        <Pressable
                            onPress={onOpenSettings}
                            hitSlop={8}
                            style={({ pressed }) => [styles.settingsButton, { opacity: pressed ? 0.62 : 1 }]}
                        >
                            <Ionicons name="options-outline" size={21} color={colors.onSurface} />
                        </Pressable>
                    </View>
                </View>

                <View style={[
                    styles.searchDock,
                    {
                        backgroundColor: palette.searchBackground,
                        borderColor: isFocused ? withAlpha(accentColor, '8A') : palette.searchBorder,
                    },
                ]}>
                    <Searchbar
                        placeholder="Artistas, canciones, álbumes…"
                        value={query}
                        onChangeText={setQuery}
                        onFocus={() => onFocusChange(true)}
                        onBlur={() => onFocusChange(false)}
                        onSubmitEditing={handleSubmitSearch}
                        returnKeyType="search"
                        submitBehavior="submit"
                        style={[styles.searchbar, { backgroundColor: 'transparent' }]}
                        iconColor={accentColor}
                        inputStyle={[styles.searchInput, { color: colors.onSurface }]}
                        placeholderTextColor={withAlpha(colors.onSurfaceVariant, '66')}
                    />
                </View>
            </View>

            {hasCommittedQuery ? (
                <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    bounces={false}
                    contentContainerStyle={styles.filterRow}
                    style={styles.filterScroller}
                >
                    {resultTabs.map((tab) => {
                        const selected = activeTab === tab.key;
                        return (
                            <Pressable
                                key={tab.key}
                                onPress={() => setActiveTab(tab.key)}
                                style={[
                                    styles.filterChip,
                                    {
                                        backgroundColor: selected ? accentColor : withAlpha(colors.surfaceVariant, '5A'),
                                        borderColor: selected ? accentColor : palette.cardBorder,
                                    },
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.filterChipLabel,
                                        { color: selected ? colors.onPrimary : colors.onSurfaceVariant },
                                    ]}
                                >
                                    {tab.label}
                                </Text>
                            </Pressable>
                        );
                    })}
                </ScrollView>
            ) : null}

            {searchHealthBanner && (hasCommittedQuery || hasQuery) ? (
                <View
                    style={[
                        styles.searchBanner,
                        {
                            borderColor:
                                searchHealthBanner.tone === 'error'
                                    ? withAlpha(colors.error, '66')
                                    : withAlpha('#F59E0B', '66'),
                            backgroundColor:
                                searchHealthBanner.tone === 'error'
                                    ? withAlpha(colors.error, '14')
                                    : withAlpha('#F59E0B', '14'),
                        },
                    ]}
                >
                    <Text
                        variant="labelSmall"
                        style={[
                            styles.searchBannerText,
                            {
                                color:
                                    searchHealthBanner.tone === 'error'
                                        ? colors.error
                                        : withAlpha(colors.onSurfaceVariant, 'DD'),
                            },
                        ]}
                    >
                        {searchHealthBanner.tone === 'error' ? 'Servicio no disponible.' : 'Servicio inestable.'}
                    </Text>
                </View>
            ) : null}

            {!hasQuery && isFocused && recentSearches.length > 0 ? (
                <View style={styles.recentSection}>
                    <View style={styles.sectionHeader}>
                        <Text variant="titleMedium" style={[styles.sectionTitle, { color: colors.onBackground }]}>Búsquedas recientes</Text>
                    </View>
                    <View style={styles.recentSearchList}>
                        {recentSearches.map((item, index) => (
                            <Pressable
                                key={item}
                                onPress={() => applySuggestion(item)}
                                style={[styles.recentSearchCard, { borderBottomColor: palette.cardBorder }]}
                            >
                                <Text style={[styles.recentSearchIndex, { color: withAlpha(colors.onSurfaceVariant, 'CC') }]}>
                                    {String(index + 1).padStart(2, '0')}
                                </Text>
                                <View style={styles.recentSearchContent}>
                                    <Text numberOfLines={1} style={[styles.recentSearchTitle, { color: colors.onSurface }]}>
                                        {formatRecentSearchTitle(item)}
                                    </Text>
                                </View>
                                <Ionicons name="chevron-forward" size={16} color={colors.onSurfaceVariant} />
                            </Pressable>
                        ))}
                    </View>
                </View>
            ) : null}
        </>
    );
});
