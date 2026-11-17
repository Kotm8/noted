import { useEffect, useRef } from "react";
import { money } from "./money";

export function ProfitGauge({
  profit,
  maximum,
  currency,
}: {
  profit: number;
  maximum: number;
  currency: string;
}) {
  const indicator = useRef<SVGGElement>(null);
  const sector = useRef<SVGPathElement>(null);
  const arc = useRef<SVGPathElement>(null);
  const current = useRef(0);
  const ratio = Math.max(-1, Math.min(1, profit / Math.max(1, maximum)));
  useEffect(() => {
    if (indicator.current) delete indicator.current.dataset.animation;
    const start = current.current;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let began: number | null = null;
    function draw(angle: number) {
      current.current = angle;
      const radians = (angle * Math.PI) / 180;
      const x = 180 + 152 * Math.sin(radians);
      const y = 174 - 152 * Math.cos(radians);
      const sweep = angle >= 0 ? 1 : 0;
      const color =
        angle >= 0 ? "var(--finance-positive)" : "var(--finance-negative)";
      const path = `A152 152 0 0 ${sweep} ${x} ${y}`;
      sector.current?.setAttribute(
        "d",
        Math.abs(angle) < 0.001 ? "" : `M180 174L180 22 ${path} Z`,
      );
      arc.current?.setAttribute(
        "d",
        Math.abs(angle) < 0.001 ? "" : `M180 22 ${path}`,
      );
      sector.current?.setAttribute("fill", color);
      arc.current?.setAttribute("stroke", color);
      indicator.current?.setAttribute("transform", `rotate(${angle} 180 174)`);
    }
    function tick(now: number) {
      began ??= now;
      const progress = reduced ? 1 : Math.min(1, (now - began) / 850);
      draw(start + (ratio * 90 - start) * (1 - Math.pow(1 - progress, 3)));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else if (indicator.current)
        indicator.current.dataset.animation = "complete";
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ratio]);
  return (
    <section
      className="finance-gauge"
      role="meter"
      aria-label="Monthly profit or loss"
      aria-valuemin={-maximum / 100}
      aria-valuemax={maximum / 100}
      aria-valuenow={(ratio * maximum) / 100}
      aria-valuetext={money(profit, currency)}
    >
      <svg viewBox="0 0 360 220" aria-hidden="true">
        <path ref={sector} fillOpacity=".2" />
        <path
          className="finance-gauge-track"
          d="M28 174 A152 152 0 0 1 332 174"
        />
        <path ref={arc} fill="none" strokeWidth="3" />
        <path
          className="finance-gauge-ticks"
          d="M180 16V29 M23 174H35 M325 174H337"
        />
        <text x="180" y="10" textAnchor="middle">
          0
        </text>
        <text x="16" y="202">
          {money(-maximum, currency, true)}
        </text>
        <text x="344" y="202" textAnchor="end">
          +{money(maximum, currency, true)}
        </text>
        <g ref={indicator}>
          <path className="finance-gauge-needle" d="M180 174V44" />
        </g>
        <circle cx="180" cy="174" r="5" fill="var(--accent)" />
      </svg>
      <strong>
        {profit > 0 ? "+" : ""}
        {money(profit, currency)}
      </strong>
      <span>
        {profit < 0
          ? "Loss this month"
          : profit > 0
            ? "Profit this month"
            : "Breaking even"}
      </span>
    </section>
  );
}
