import { NativeMiniPlayerView, type ChromeAction } from '@/modules/player-chrome/src';
import { useI18n } from '@/src/i18n';
import { useTheme } from '@/src/theme';
import React, { memo, useCallback, useMemo } from 'react';
import { StyleSheet, type NativeSyntheticEvent } from 'react-native';
import { processColor, useAnimatedProps, type SharedValue } from 'react-native-reanimated';

type Props = {
    track: { id: string; title?: string | null; artist?: string | null };
    expansion: SharedValue<number> | null;
    titleColor: SharedValue<string>;
    playInk: string;
    controlInk: string;
    playFill: string;
    loading: boolean;
    showPause: boolean;
    onOpen: () => void;
    onToggle: () => void;
    onPrevious: () => void;
    onNext: () => void;
};

export const AndroidMiniPlayer = memo(function AndroidMiniPlayer(props: Props) {
    const { language } = useI18n();
    const { config } = useTheme();
    const { expansion, titleColor, onOpen, onToggle, onPrevious, onNext } = props;
    const track = useMemo(() => ({
        id: props.track.id, title: props.track.title ?? '', artist: props.track.artist ?? '',
    }), [props.track.id, props.track.title, props.track.artist]);
    const labels = useMemo(() => language === 'es' ? {
        open: 'Abrir reproductor', previous: 'Canción anterior', next: 'Siguiente canción',
        play: 'Reproducir', pause: 'Pausar', loading: 'Cargando canción',
    } : {
        open: 'Open player', previous: 'Previous track', next: 'Next track',
        play: 'Play', pause: 'Pause', loading: 'Loading track',
    }, [language]);
    const appearance = useMemo(() => ({
        motion: config.lightweightMode ? 'off' : 'on',
        playInk: props.playInk, controlInk: props.controlInk, playFill: props.playFill,
    }), [props.playInk, props.controlInk, props.playFill, config.lightweightMode]);
    // Direct UI-runtime prop updates: no runOnJS / React renders for transition frames.
    const animatedProps = useAnimatedProps(() => ({
        expansionProgress: expansion?.value ?? 0,
        titleColor: processColor(titleColor.value) as number,
    }));
    const onAction = useCallback(({ nativeEvent }: NativeSyntheticEvent<ChromeAction>) => {
        switch (nativeEvent.action) {
            case 'open': onOpen(); break;
            case 'toggle': onToggle(); break;
            case 'previous': onPrevious(); break;
            case 'next': onNext(); break;
        }
    }, [onOpen, onToggle, onPrevious, onNext]);
    if (!NativeMiniPlayerView) return null;
    return <NativeMiniPlayerView style={styles.fill} track={track} labels={labels} appearance={appearance}
        loading={props.loading} paused={!props.showPause} animatedProps={animatedProps} onAction={onAction} />;
});
const styles = StyleSheet.create({ fill: { flex: 1 } });
