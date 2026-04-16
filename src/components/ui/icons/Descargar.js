import * as React from "react";
import Svg, { Circle, Path } from "react-native-svg";
const SvgDescargar = (props) => (
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
      d="M12 7.4v7.2"
      stroke={props.color || "#ffffff"}
      strokeWidth={2}
      strokeLinecap="round"
    />
    <Path
      d="m8.8 11.7 3.2 3.2 3.2-3.2"
      stroke={props.color || "#ffffff"}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="none"
    />
  </Svg>
);
export default SvgDescargar;
