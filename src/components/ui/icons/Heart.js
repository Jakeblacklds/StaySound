import * as React from "react";
import Svg, { Path } from "react-native-svg";

const SvgHeart = (props) => (
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
    <Path
      d="M12 21.35c-.34 0-.68-.12-.94-.35l-1.65-1.5C4.48 15.07 2 12.8 2 9.99 2 7.7 3.79 6 6.06 6c1.3 0 2.55.61 3.34 1.65L12 10.5l2.6-2.85A4.54 4.54 0 0 1 17.94 6C20.21 6 22 7.7 22 9.99c0 2.81-2.48 5.08-7.41 9.51l-1.65 1.5c-.26.23-.6.35-.94.35Z"
      fill={props.color || "#ffffff"}
      fillOpacity={0.92}
    />
  </Svg>
);

export default SvgHeart;
