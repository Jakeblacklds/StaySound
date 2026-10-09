import React from 'react';
import NativeOnboardingScreen, { hasNativeOnboarding } from '@/src/features/onboarding/NativeOnboardingScreen';
import ReactOnboardingScreen from '@/src/features/onboarding/ReactOnboardingScreen';

export default function OnboardingScreen() {
    return hasNativeOnboarding ? <NativeOnboardingScreen /> : <ReactOnboardingScreen />;
}
