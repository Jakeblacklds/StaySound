import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgPause = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 148 215"
    {...props}
  >
    <Path
      d="M95.518 164.687c.152-120.777-.034-120.754.069-131.718.198-21.27 38.605-33.499 38.375 6.618-.085 14.794.004 124.126-.076 126.75-.812 26.531-37.157 31.281-38.368-1.65"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
    <Path d="M50.249 31.406c.04 11.053.476 133.203-.024 138.158-2.317 22.949-37.812 26.749-38.152-4.873C10.61 28.433 9.962 26.194 18.24 18.781c1.866-1.671 25.213-16.954 32.009 12.625"  fill={props.color || "#ffffff"} fillOpacity={0.2}/>
  </Svg>
);
export default SvgPause;
