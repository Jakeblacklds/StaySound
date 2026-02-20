import React, { createContext, ReactNode, useContext, useState } from 'react';
import { useColorScheme } from 'react-native';
import { Theme, ThemeConfig, ThemeMode, ThemeStyle } from '../types/theme';
import { auroraDark } from './styles/aurora';
import { brutalDark } from './styles/brutal';
import { cyberDark } from './styles/cyber';
import { material3Dark, material3Light } from './styles/material3';

const themes: Record<ThemeStyle, { dark: Theme; light: Theme }> = {
    material3: { dark: material3Dark, light: material3Light },
    aurora: { dark: auroraDark, light: auroraDark },
    cyber: { dark: cyberDark, light: cyberDark },
    brutal: { dark: brutalDark, light: brutalDark },
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

    const isDark = config.mode === 'system'
        ? systemColorScheme === 'dark'
        : config.mode === 'dark';

    const theme = React.useMemo(() => {
        const themeVariants = themes[config.style] || themes.material3;
        const selectedTheme = isDark ? themeVariants.dark : themeVariants.light;

        if (config.style === 'material3' && !config.dynamicColors && config.accentColor) {
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

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

export function useColors() {
    const { theme } = useTheme();
    return theme.colors;
}

export function useSpacing() {
    const { theme } = useTheme();
    return theme.spacing;
}

export function useComponentStyles() {
    const { theme } = useTheme();
    return theme.components;
}
