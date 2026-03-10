import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgPlay = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 224 215"
    {...props}
  >
    <Path
      d="M171.305 118.873c-9.445 8.201-14.814 14.094-86.253 58.175-18.123 11.183-39.022 21.23-39.95-11.035-.587-20.404-1.124-126.736-.338-133.094 4.291-34.686 24.394-19.638 79.494 14.577 57.752 35.862 57.865 44.237 56.429 55.086-.88 6.651-8.404 15.182-9.382 16.291"
      fill={props.color || "#ffffff"} fillOpacity={0.45} style={{ fillOpacity: 1 }}
    />
    <Path
      d="M156.707 112.975c-7.585 6.585-11.896 11.318-69.265 46.717-14.554 8.98-31.336 17.048-32.082-8.862-.472-16.386-.903-101.774-.271-106.88 3.446-27.854 19.589-15.77 63.837 11.706 46.377 28.799 46.468 35.524 45.315 44.236-.707 5.341-6.749 12.192-7.534 13.083"
      fill={props.color || "#ffffff"} fillOpacity={1} style={{ fillOpacity: 0.61 }}
    />
  </Svg>
);
export default SvgPlay;
