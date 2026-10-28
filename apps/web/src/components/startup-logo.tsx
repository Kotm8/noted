import { useId } from "react";

export function StartupLogo() {
  const id = useId();
  return (
    <svg
      className="startup-logo"
      viewBox="0 0 98 96"
      fill="none"
      aria-label="Noted"
      role="img"
    >
      <defs>
        <mask id={id}>
          <rect
            className="startup-line"
            x="26.7"
            y="32"
            width="12.8"
            height="39"
            fill="white"
          />
          <path
            className="startup-curve"
            d="M37 44Q60 19 59.2 48V71"
            pathLength="100"
            stroke="white"
            strokeWidth="20"
          />
          <rect
            className="startup-curve-finish"
            x="39.5"
            y="30.8"
            width="26.1"
            height="40.2"
            fill="white"
          />
        </mask>
        <clipPath id={`${id}-body`}>
          <path clipRule="evenodd" d="M0 0H98V96H0ZM52 49H67V72H52Z" />
        </clipPath>
        <clipPath id={`${id}-leg`}>
          <path d="M52.8 72V49A6.4 6.4 0 0 1 65.6 49V72Z" />
        </clipPath>
      </defs>
      <path
        mask={`url(#${id})`}
        clipPath={`url(#${id}-body)`}
        d="M26.7 32H39.5V37.7C42.4 33.2 46.4 30.8 51.9 30.8C61.2 30.8 65.6 37 65.6 47V71H52.8V48.6C52.8 42.7 51.2 40 47.1 40C42.1 40 39.5 43.7 39.5 50.4V71H26.7V32Z"
        fill="#CCCCCC"
      />
      <circle mask={`url(#${id})`} cx="59.2" cy="49" r="6.4" fill="#CCCCCC" />
      <path
        className="startup-leg"
        mask={`url(#${id})`}
        clipPath={`url(#${id}-leg)`}
        d="M26.7 32H39.5V37.7C42.4 33.2 46.4 30.8 51.9 30.8C61.2 30.8 65.6 37 65.6 47V71H52.8V48.6C52.8 42.7 51.2 40 47.1 40C42.1 40 39.5 43.7 39.5 50.4V71H26.7V32Z"
        fill="#CCCCCC"
      />
      <path
        className="startup-dot"
        d="M67.5 72C71.4765 72 74.7 69.0899 74.7 65.5C74.7 61.9101 71.4765 59 67.5 59C63.5236 59 60.3 61.9101 60.3 65.5C60.3 69.0899 63.5236 72 67.5 72Z"
        fill="#E2C15A"
      />
    </svg>
  );
}
