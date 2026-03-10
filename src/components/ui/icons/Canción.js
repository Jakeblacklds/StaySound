import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgCancin = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 191 177"
    {...props}
  >
    <Path
      d="M111.55 31.827c8.693-2.366 29.214-8.518 31.759-7.652 2.717.924 3.927 1.759 3.229 38.663-1.207 63.879 3.98 78.443-12.256 87.949-27.638 16.182-49.489-22.068-30.168-39.65 15.305-13.927 30.834-1.35 31.51-1.638 1.059-.451 2.479-45.81-1.18-46.063-.37-.026-50.099 10.221-50.551 10.47-2.969 1.634-1.754 50.511-2.515 70.329-.772 20.092-22.894 28.032-35.361 23.229-35.262-13.584-10.758-68.098 22.732-46.763 5.411 3.447 2.521-2.758 3.202-20.633 1.549-40.675.325-55.437 3.093-57.9 3.325-2.959 33.549-9.684 36.505-10.341Z"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
  </Svg>
);
export default SvgCancin;
