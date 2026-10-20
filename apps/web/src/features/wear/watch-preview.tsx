export function WatchPreview({
  face,
  accent,
  hidden,
}: {
  face: string;
  accent: string;
  hidden: boolean;
}) {
  return (
    <figure className="watch-preferences-preview">
      <svg
        viewBox="0 0 400 400"
        role="img"
        aria-label={`${face} watch face preview with sample content`}
      >
        <circle
          cx="200"
          cy="200"
          r="196"
          fill="#080a09"
          stroke="var(--border-default)"
          strokeWidth="2"
        />
        <text
          x="200"
          y="99"
          fill="#efeee7"
          textAnchor="middle"
          fontSize="51"
          fontWeight="600"
        >
          10:08
        </text>
        {face === "W24" ? (
          <>
            <text x="75" y="149" fontSize="10" fill="#929c8e">
              PLANNED
            </text>
            <rect
              x="65"
              y="163"
              width="115"
              height="45"
              rx="5"
              fill="#302f1d"
            />
            <text
              x="123"
              y="192"
              fontSize="17"
              textAnchor="middle"
              fill={accent}
            >
              {hidden ? "Plan" : "Work"}
            </text>
            <rect
              x="192"
              y="163"
              width="60"
              height="45"
              rx="5"
              fill="#243329"
            />
            <text
              x="222"
              y="192"
              fontSize="15"
              textAnchor="middle"
              fill="#a8c4b0"
            >
              Walk
            </text>
            <rect
              x="264"
              y="163"
              width="71"
              height="45"
              rx="5"
              fill="#25313a"
            />
            <text
              x="299"
              y="192"
              fontSize="15"
              textAnchor="middle"
              fill="#a8c9e0"
            >
              Read
            </text>
            <text x="75" y="245" fontSize="10" fill="#929c8e">
              ACTUAL
            </text>
            <rect x="65" y="259" width="53" height="22" rx="4" fill="#829b85" />
            <rect x="123" y="259" width="44" height="22" rx="4" fill={accent} />
            <path d="M167 151V293" stroke={accent} />
          </>
        ) : (
          <>
            {face === "W07" && (
              <path d="M74 151V289" stroke="#3b4735" strokeWidth="2" />
            )}
            <text x="88" y="158" fontSize="11" fill={accent}>
              CURRENT ACTIVITY
            </text>
            <text x="88" y="190" fontSize="25" fill="#efeee7">
              {hidden ? "Current activity" : "Building Noted"}
            </text>
            <path d="M88 219H312" stroke="#30382a" />
            <text x="88" y="257" fontSize="17" fill={accent}>
              11:00
            </text>
            <text x="164" y="257" fontSize="20" fill="#efeee7">
              {hidden ? "Plan" : "Walk outside"}
            </text>
            <text x="88" y="294" fontSize="17" fill="#a8c9e0">
              12:30
            </text>
            <text x="164" y="294" fontSize="20" fill="#efeee7">
              {hidden ? "Plan" : "Reading"}
            </text>
          </>
        )}
        <text x="200" y="337" textAnchor="middle" fontSize="18" fill={accent}>
          00:42:18
        </text>
      </svg>
      <figcaption>Layout preview · sample data</figcaption>
    </figure>
  );
}
