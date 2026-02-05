import { Stack } from 'expo-router';

export default function PlaylistLayout() {
    return (
        <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen
                name="[id]"
                options={{
                    presentation: 'card',
                    animation: 'slide_from_right',
                }}
            />
        </Stack>
    );
}
