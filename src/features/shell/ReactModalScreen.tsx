import { ImmersiveGlass } from '@/src/components/ui';
import { useTheme } from '@/src/theme';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from 'react-native-paper';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function ModalScreen() {
  const { theme } = useTheme();

  return (
    <SafeAreaView style={styles.container}>
      <ImmersiveGlass tone="strong" style={styles.panel}>
        <View style={[styles.icon, { backgroundColor: `${theme.colors.primaryContainer}B8` }]}>
          <Ionicons name="musical-notes" size={30} color={theme.colors.onPrimaryContainer} />
        </View>
        <Text style={[styles.title, { color: theme.colors.onSurface }]}>StaySound</Text>
        <Text style={[styles.copy, { color: theme.colors.onSurfaceVariant }]}>Tu música sigue contigo.</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.back()}
          style={[styles.button, { backgroundColor: theme.colors.primary }]}
        >
          <Text style={[styles.buttonLabel, { color: theme.colors.onPrimary }]}>Cerrar</Text>
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
    padding: 28,
    gap: 10,
  },
  icon: {
    width: 72,
    height: 72,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  title: {
    fontSize: 24,
    lineHeight: 30,
    fontWeight: '800',
    letterSpacing: -0.6,
  },
  copy: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  button: {
    minWidth: 150,
    minHeight: 50,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  buttonLabel: {
    fontSize: 14,
    fontWeight: '800',
  },
});
