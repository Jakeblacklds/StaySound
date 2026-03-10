import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgPrevious = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 200 193"
    {...props}
  >
    <Path
      d="M96.625 106.246c.006 1.212 2.533 32.427-5.886 39.576-11.49 9.756-23.157-3.558-29.806-9.191C9.543 93.1-.301 89.763 6.801 70.403c.318-.867 14.528-15.128 31.002-29.491 18.929-16.504 40.846-33.145 48.112-29.76 14.584 6.795 10.648 36.418 10.657 41.316.076 27.009.09 26.725.054 53.777Z"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
    <Path
      d="M96.625 106.246c.036-27.053.022-26.769-.054-53.777 34.266-26.429 63.756-62.644 71.082-27.093 1.16 5.631.646 104.987.592 105.624-4.036 47.65-52.391-13.563-71.62-24.753Z"
      fill={props.color || "#ffffff"} fillOpacity={0.45}
    />
  </Svg>
);
export default SvgPrevious;
