import { MaterialLiquidTabBar } from '@/src/components/navigation/MaterialLiquidTabBar';
import { CustomIcon } from '@/src/components/ui';
import { useI18n } from '@/src/i18n';
import { typeScale, useTheme } from '@/src/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Tabs } from 'expo-router';
import React from 'react';
import { StyleSheet, View } from 'react-native';

export default function TabLayout() {
  const { theme, config } = useTheme();
  const { t } = useI18n();
  const isMaterial3 = config.style === 'material3';

  return (
    <View style={styles.container}>
      <Tabs
        tabBar={isMaterial3 ? (props: BottomTabBarProps) => <MaterialLiquidTabBar {...props} /> : undefined}
        screenOptions={{
          animation: 'fade',
          headerShown: false,
          sceneStyle: styles.transparentScene,
          tabBarActiveTintColor: theme.colors.primary,
          tabBarInactiveTintColor: theme.colors.onSurfaceVariant,
          tabBarStyle: {
            backgroundColor: theme.colors.surface,
            borderTopWidth: 0,
            paddingTop: 8,
            height: 85,
          },
          tabBarLabelStyle: {
            ...typeScale.micro,
          },
        }}>
        <Tabs.Screen
          name="index"
          options={{
            title: t('tabs.home'),
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
            title: t('tabs.library'),
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
          name="tidal"
          options={{
            title: 'Buscar',
            tabBarIcon: ({ color }) => (
              <MaterialCommunityIcons
                name="magnify"
                size={26}
                color={color}
              />
            ),
          }}
        />
        <Tabs.Screen
          name="playlists"
          options={{
            title: t('tabs.playlists'),
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
          name="settings"
          options={{
            href: null,
            title: t('tabs.settings'),
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  transparentScene: {
    backgroundColor: 'transparent',
  },
});
