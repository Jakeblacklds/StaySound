import * as React from "react";
import Svg, { Path } from "react-native-svg";
const SvgCola = (props) => (
  <Svg
    xmlns="http://www.w3.org/2000/svg"
    xmlSpace="preserve"
    style={{
      fillRule: "evenodd",
      clipRule: "evenodd",
      strokeLinejoin: "round",
      strokeMiterlimit: 2,
    }}
    viewBox="0 0 225 182"
    {...props}
  >
    <Path
      d="M62.768 27.406c-.71-1.023-6.866-9.891 1.469-15.961 1.33-.968 1.312-1.751 75.843-1.762 53.424-.007 57.364-1.274 58.546 8.868 1.796 15.413-22.319 11.754-24.617 11.75-105.264-.197-105.816.94-111.242-2.896Z"
      fill={props.color || "#ffffff"} fillOpacity={0.35}
    />
    <Path
      d="M196.856 126.886c7.614 19.839-6.873 15.962-70.348 16.162-59.354.187-67.211 2.028-66.809-10.447.381-11.83 5.939-9.882 79.024-9.905 51.99-.017 52.712-.852 58.132 4.189Z"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
    <Path
      d="M136.009 86.604c-70.087-.188-74.601 1.876-75.947-8.795-1.711-13.569 8.552-11.529 61.016-11.451 71.465.106 75.946-1.981 77.34 8.5 1.861 13.995-9.082 11.624-62.409 11.746"
      fill={props.color || "#ffffff"} fillOpacity={0.51}
    />
    <Path
      d="M39.469 66.161c17.658 24.442-23.813 39.312-25.517 11.654-.643-10.435 10.975-24.487 25.517-11.654"
      fill={props.color || "#ffffff"} fillOpacity={0.68}
    />
    <Path
      d="M38.121 8.441c21.24 24.405-22.412 42.177-24.192 13.096-.553-9.037 9.473-22.965 24.192-13.096"
      fill={props.color || "#ffffff"} fillOpacity={0.84}
    />
    <Path
      d="M38.05 145.619c-27.638 17.339-32.928-32.384-6.548-27.794 7.329 1.275 19.359 13.547 6.548 27.794"
      fill={props.color || "#ffffff"} fillOpacity={1}
    />
  </Svg>
);
export default SvgCola;
