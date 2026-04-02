import { useEffect } from 'react';
import { InteractionManager } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';

type ScreenEntryAnimationOptions = {
  delay?: number;
  duration?: number;
  translateY?: number;
  opacityFrom?: number;
};

export function useScreenEntryAnimation(
  trigger: number,
  {
    delay = 0,
    duration = 320,
    translateY = 18,
    opacityFrom = 0,
  }: ScreenEntryAnimationOptions = {},
) {
  const opacity = useSharedValue(opacityFrom);
  const offsetY = useSharedValue(translateY);

  useEffect(() => {
    opacity.value = opacityFrom;
    offsetY.value = translateY;

    const task = InteractionManager.runAfterInteractions(() => {
      opacity.value = withDelay(
        delay,
        withTiming(1, {
          duration,
          easing: Easing.out(Easing.cubic),
        }),
      );

      offsetY.value = withDelay(
        delay,
        withTiming(0, {
          duration: duration + 40,
          easing: Easing.out(Easing.cubic),
        }),
      );
    });

    return () => {
      task.cancel();
      cancelAnimation(opacity);
      cancelAnimation(offsetY);
    };
  }, [delay, duration, offsetY, opacity, opacityFrom, translateY, trigger]);

  return useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: offsetY.value }],
  }));
}
