import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';

export type TastePlaylistStatus = 'idle' | 'pending' | 'ready' | 'failed';

export interface OnboardingTasteArtist {
    id: number;
    name: string;
    artworkUrl?: string;
}

interface OnboardingState {
    hasCompletedOnboarding: boolean;
    userName: string;
    userAvatarUri: string | null;
    tasteArtists: OnboardingTasteArtist[];
    tasteTrackIds: number[];
    tastePlaylistStatus: TastePlaylistStatus;
    tastePlaylistGeneratedAt: number | null;
    tasteProfileVersion: number;
    _hasHydrated: boolean;
}

interface OnboardingActions {
    completeOnboarding: () => void;
    setUserName: (name: string) => void;
    setUserAvatarUri: (uri: string | null) => void;
    setTasteArtists: (artists: OnboardingTasteArtist[]) => void;
    setTasteTrackIds: (trackIds: number[]) => void;
    setTastePlaylistStatus: (status: TastePlaylistStatus) => void;
    setTasteProfileVersion: (version: number) => void;
    markTastePlaylistGenerated: (generatedAt?: number) => void;
    resetTasteProfile: () => void;
    resetOnboarding: () => void;
    setHasHydrated: (hydrated: boolean) => void;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

const initialState: OnboardingState = {
    hasCompletedOnboarding: false,
    userName: '',
    userAvatarUri: null,
    tasteArtists: [],
    tasteTrackIds: [],
    tastePlaylistStatus: 'idle',
    tastePlaylistGeneratedAt: null,
    tasteProfileVersion: 1,
    _hasHydrated: false,
};

export const useOnboardingStore = create<OnboardingStore>()(
    persist(
        (set) => ({
            ...initialState,
            completeOnboarding: () => set({ hasCompletedOnboarding: true }),
            setUserName: (name) => set({ userName: name }),
            setUserAvatarUri: (uri) => set({ userAvatarUri: uri }),
            setTasteArtists: (artists) => set({ tasteArtists: artists }),
            setTasteTrackIds: (trackIds) => set({ tasteTrackIds: trackIds }),
            setTastePlaylistStatus: (status) => set({ tastePlaylistStatus: status }),
            setTasteProfileVersion: (version) => set({ tasteProfileVersion: version }),
            markTastePlaylistGenerated: (generatedAt = Date.now()) => set({
                tastePlaylistStatus: 'ready',
                tastePlaylistGeneratedAt: generatedAt,
            }),
            resetTasteProfile: () => set({
                tasteArtists: [],
                tasteTrackIds: [],
                tastePlaylistStatus: 'idle',
                tastePlaylistGeneratedAt: null,
                tasteProfileVersion: 1,
            }),
            resetOnboarding: () => set({
                hasCompletedOnboarding: false,
                userName: '',
                userAvatarUri: null,
                tasteArtists: [],
                tasteTrackIds: [],
                tastePlaylistStatus: 'idle',
                tastePlaylistGeneratedAt: null,
                tasteProfileVersion: 1,
            }),
            setHasHydrated: (hydrated) => set({ _hasHydrated: hydrated }),
        }),
        {
            name: 'staysound-onboarding',
            storage: createJSONStorage(() => FileSystemStorage),
            onRehydrateStorage: () => (state) => {
                state?.setHasHydrated(true);
            },
        }
    )
);
