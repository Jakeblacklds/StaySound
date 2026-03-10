import { MaterialLiquidTabBar } from '@/src/components/navigation/MaterialLiquidTabBar';
import { CustomIcon } from '@/src/components/ui';
import { useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import React from 'react';

export default function TabLayout() {
  const { theme, config } = useTheme();
  const isMaterial3 = config.style === 'material3';

  return (
    <Tabs
      tabBar={isMaterial3 ? (props: BottomTabBarProps) => <MaterialLiquidTabBar {...props} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.colors.primary,
        tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
        tabBarStyle: {
          backgroundColor: theme.colors.surface,
          borderTopColor: theme.colors.outline,
          borderTopWidth: 0.5,
          paddingTop: 8,
          height: 85,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
      }}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Inicio',
          tabBarIcon: ({ color }) => (
            <CustomIcon
              name="Home"
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="library"
        options={{
          title: 'Biblioteca',
          tabBarIcon: ({ color }) => (
            <CustomIcon
              name="Library"
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="playlists"
        options={{
          title: 'Playlists',
          tabBarIcon: ({ color }) => (
            <CustomIcon
              name="Playlist"
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="tidal"
        options={{
          title: 'Descargar',
          tabBarIcon: ({ color }) => (
            <CustomIcon
              name="Descargar"
              size={26}
              color={color}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          title: 'Ajustes',
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons
              name="cog"
              size={26}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}
