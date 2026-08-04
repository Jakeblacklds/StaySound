import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgAjustes = (props) => (
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
      d="M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.61-.22l-2.49 1a7.7 7.7 0 0 0-1.69-.98L14.5 2.42A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.49.42L9.13 5.07c-.61.25-1.18.58-1.69.98l-2.49-1a.5.5 0 0 0-.61.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.08.65-.08.98s.03.66.08.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.14.24.43.34.7.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.28.28.49.56.49h4c.28 0 .52-.21.56-.49l.38-2.65c.61-.25 1.18-.58 1.69-.98l2.49 1c.27.11.56.02.7-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z"
      fill={props.color || "#ffffff"}
    />
  </Svg>
);
export default SvgAjustes;
