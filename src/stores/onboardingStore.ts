import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { FileSystemStorage } from '../services/storage';

interface OnboardingState {
    hasCompletedOnboarding: boolean;
    userName: string;
    userAvatarUri: string | null;
    _hasHydrated: boolean;
}

interface OnboardingActions {
    completeOnboarding: () => void;
    setUserName: (name: string) => void;
    setUserAvatarUri: (uri: string | null) => void;
    resetOnboarding: () => void;
    setHasHydrated: (hydrated: boolean) => void;
}

export type OnboardingStore = OnboardingState & OnboardingActions;

const initialState: OnboardingState = {
    hasCompletedOnboarding: false,
    userName: '',
    userAvatarUri: null,
    _hasHydrated: false,
};

export const useOnboardingStore = create<OnboardingStore>()(
    persist(
        (set) => ({
            ...initialState,
            completeOnboarding: () => set({ hasCompletedOnboarding: true }),
            setUserName: (name) => set({ userName: name }),
            setUserAvatarUri: (uri) => set({ userAvatarUri: uri }),
            resetOnboarding: () => set({ hasCompletedOnboarding: false, userName: '', userAvatarUri: null }),
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
