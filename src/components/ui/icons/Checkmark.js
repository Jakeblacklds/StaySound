import * as React from "react";
import Svg, { Circle, Path } from "react-native-svg";

const SvgCheckmark = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 24 24"
    {...props}
  >
    <Circle
      cx={12}
      cy={12}
      r={9}
      stroke={props.color || "#ffffff"}
      strokeWidth={1.9}
      fill="none"
    />
    <Path
      d="m8.45 12.15 2.35 2.35 4.8-5.1"
      stroke={props.color || "#ffffff"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);

export default SvgCheckmark;
