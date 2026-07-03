import { Stack } from 'expo-router';

export default function AlbumLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen
                name="[id]"
                options={{
                    presentation: 'card',
                    animation: 'slide_from_right',
                    // Cap the push/pop duration so leaving the album feels snappy
                    // instead of riding the long platform default.
                    animationDuration: 240,
                }}
            />
        </Stack>
    );
}
