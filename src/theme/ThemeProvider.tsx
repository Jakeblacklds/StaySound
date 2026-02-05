import React, { createContext, ReactNode, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Theme, ThemeConfig, ThemeMode, ThemeStyle } from '../types/theme';
import { material3Dark, material3Light } from './styles/material3';
import { minimalDark, minimalLight } from './styles/minimal';
import { spotifyDark, spotifyLight } from './styles/spotify';

// Theme registry
const themes: Record<ThemeStyle, { dark: Theme; light: Theme }> = {
    minimal: { dark: minimalDark, light: minimalLight },
    material3: { dark: material3Dark, light: material3Light },
    spotify: { dark: spotifyDark, light: spotifyLight },
    custom: { dark: minimalDark, light: minimalLight }, // Fallback, will be overridden
};

interface ThemeContextType {
    theme: Theme;
    config: ThemeConfig;
    setThemeStyle: (style: ThemeStyle) => void;
    setThemeMode: (mode: ThemeMode) => void;
    setAccentColor: (color: string) => void;
    toggleDynamicColors: () => void;
    isDark: boolean;
}

const defaultConfig: ThemeConfig = {
    style: 'material3',
    mode: 'system',
    accentColor: '#6750A4',
    dynamicColors: true,
};

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

interface ThemeProviderProps {
    children: ReactNode;
    initialConfig?: Partial<ThemeConfig>;
}

export function ThemeProvider({ children, initialConfig }: ThemeProviderProps) {
    const systemColorScheme = useColorScheme();
    const [config, setConfig] = useState<ThemeConfig>({
        ...defaultConfig,
        ...initialConfig,
    });

    // Determine if dark mode based on config and system preference
    const isDark = config.mode === 'system'
        ? systemColorScheme === 'dark'
        : config.mode === 'dark';

    // Get theme based on style and mode
    const theme = React.useMemo(() => {
        const themeVariants = themes[config.style] || themes.material3;
        const selectedTheme = isDark ? themeVariants.dark : themeVariants.light;

        // Apply accent color if not using dynamic colors
        if (!config.dynamicColors && config.accentColor) {
            return {
                ...selectedTheme,
                colors: {
                    ...selectedTheme.colors,
                    primary: config.accentColor,
                },
            };
        }

        return selectedTheme;
    }, [config, isDark]);

    const setThemeStyle = (style: ThemeStyle) => {
        setConfig(prev => ({ ...prev, style }));
    };

    const setThemeMode = (mode: ThemeMode) => {
        setConfig(prev => ({ ...prev, mode }));
    };

    const setAccentColor = (color: string) => {
        setConfig(prev => ({ ...prev, accentColor: color }));
    };

    const toggleDynamicColors = () => {
        setConfig(prev => ({ ...prev, dynamicColors: !prev.dynamicColors }));
    };

    const value: ThemeContextType = {
        theme,
        config,
        setThemeStyle,
        setThemeMode,
        setAccentColor,
        toggleDynamicColors,
        isDark,
    };

    return (
        <ThemeContext.Provider value={value}>
            {children}
        </ThemeContext.Provider>
    );
}

// Hook to use theme
export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

// Hook for just the colors (convenience)
export function useColors() {
    const { theme } = useTheme();
    return theme.colors;
}

// Hook for just the spacing
export function useSpacing() {
    const { theme } = useTheme();
    return theme.spacing;
}

// Hook for component styles (new)
export function useComponentStyles() {
    const { theme } = useTheme();
    return theme.components;
}

