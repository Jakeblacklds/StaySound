import { ImmersiveGlass } from '@/src/components/ui';
import { useTheme } from '@/src/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function NotFoundScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={styles.container}>
      <ImmersiveGlass tone="regular" style={styles.panel}>
        <View style={[styles.icon, { backgroundColor: `${theme.colors.primaryContainer}A8` }]}>
          <Ionicons name="compass-outline" size={32} color={theme.colors.onPrimaryContainer} />
        </View>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>No encontramos esa pantalla</Text>
        <Text style={[styles.copy, { color: theme.colors.onSurfaceVariant }]}>Vuelve a tu música y sigue escuchando.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.replace('/')}
          style={[styles.button, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={[styles.buttonText, { color: theme.colors.onPrimary }]}>Ir al inicio</Text>
        </Pressable>
      </ImmersiveGlass>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  panel: {
    alignItems: 'center',
    paddingHorizontal: 28,
    paddingVertical: 34,
  },
  icon: {
    width: 76,
    height: 76,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 23,
    lineHeight: 29,
    fontWeight: '800',
    letterSpacing: -0.55,
    textAlign: 'center',
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: 8,
  },
  button: {
    minHeight: 50,
    paddingHorizontal: 24,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 22,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
  },
});
