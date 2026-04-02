import { Composition } from 'remotion';
import { StaySoundPromo } from './StaySoundPromo';

export const StaySoundPromoRoot = () => {
  return (
    <>
      <Composition
        id="StaySoundPromo"
        component={StaySoundPromo}
        durationInFrames={25 * 30}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{}}
      />
    </>
  );
};
