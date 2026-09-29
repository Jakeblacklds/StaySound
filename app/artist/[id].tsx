import NativeDetailScreen, { hasNativeDetails } from '@/src/features/details/NativeDetailScreen';
import ReactArtistDetailScreen from '@/src/features/details/ReactArtistDetailScreen';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function ArtistDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const detailId = Array.isArray(id) ? id[0] : id;
    return hasNativeDetails
        ? <NativeDetailScreen key={detailId} kind="artist" id={detailId || ''} />
        : <ReactArtistDetailScreen />;
}
