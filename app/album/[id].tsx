import NativeDetailScreen, { hasNativeDetails } from '@/src/features/details/NativeDetailScreen';
import ReactAlbumDetailScreen from '@/src/features/details/ReactAlbumDetailScreen';
import { useLocalSearchParams } from 'expo-router';
import React from 'react';

export default function AlbumDetailScreen() {
    const { id } = useLocalSearchParams<{ id: string | string[] }>();
    const detailId = Array.isArray(id) ? id[0] : id;
    return hasNativeDetails
        ? <NativeDetailScreen key={detailId} kind="album" id={detailId || ''} />
        : <ReactAlbumDetailScreen />;
}
