import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgNext = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 225 193"
    {...props}
  >
    <Path
      d="M117.24 50.763c-.005-1.212-2.491-32.432 5.937-39.565 11.503-9.735 23.153 3.601 29.795 9.246 51.334 43.625 61.174 46.98 54.047 66.328-.319.867-14.547 15.101-31.039 29.434-18.95 16.469-40.889 33.069-48.15 29.671-14.575-6.822-10.602-36.438-10.604-41.336-.042-27.009-.056-26.725.014-53.777Z"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
    <Path
      d="M117.24 50.763c-.07 27.053-.056 26.769-.014 53.777-34.3 26.366-63.837 62.526-71.116 26.962-1.153-5.634-.512-104.988-.457-105.625 4.097-47.643 52.374 13.659 71.588 24.885Z"
      fill={props.color || "#ffffff"} fillOpacity={0.45}
    />
  </Svg>
);
export default SvgNext;
