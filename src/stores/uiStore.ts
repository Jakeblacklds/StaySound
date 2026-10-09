import { create } from 'zustand';
import { Track } from '../types/audio';

export type ActionItem = {
    label: string;
    icon: string;
    onPress: () => void;
    destructive?: boolean;
};

interface ConfirmationModalConfig {
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    isDestructive?: boolean;
    onConfirm: () => void;
}

interface UIState {
    actionSheetId: number;
    confirmModalId: number;
    actionSheetVisible: boolean;
    actionSheetTitle: string;
    actionSheetSubtitle?: string;
    actionSheetActions: ActionItem[];
    actionSheetTrack?: Track;

    // Confirmation Modal
    confirmModalVisible: boolean;
    confirmModalConfig: ConfirmationModalConfig | null;

    openActionSheet: (config: {
        title: string;
        subtitle?: string;
        actions: ActionItem[];
        track?: Track;
    }) => void;
    closeActionSheet: () => void;

    openConfirmModal: (config: ConfirmationModalConfig) => void;
    closeConfirmModal: () => void;
}

export const useUIStore = create<UIState>((set) => ({
    actionSheetId: 0,
    confirmModalId: 0,
    actionSheetVisible: false,
    actionSheetTitle: '',
    actionSheetSubtitle: undefined,
    actionSheetActions: [],
    actionSheetTrack: undefined,

    confirmModalVisible: false,
    confirmModalConfig: null,

    openActionSheet: (config) => set(state => ({
        actionSheetId: state.actionSheetId + 1,
        actionSheetVisible: true,
        actionSheetTitle: config.title,
        actionSheetSubtitle: config.subtitle,
        actionSheetActions: config.actions,
        actionSheetTrack: config.track,
    })),

    closeActionSheet: () => set({ actionSheetVisible: false }),

    openConfirmModal: (config) => set(state => ({
        confirmModalId: state.confirmModalId + 1,
        confirmModalVisible: true,
        confirmModalConfig: config,
    })),

    closeConfirmModal: () => set({ confirmModalVisible: false }),
}));

