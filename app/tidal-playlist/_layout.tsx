import { Stack } from 'expo-router';

export default function TidalPlaylistLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="[id]" />
        </Stack>
    );
}
