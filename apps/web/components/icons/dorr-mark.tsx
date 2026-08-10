import type { SVGProps } from "react";

/**
 * The dorr mark.
 *
 * A padlock whose shackle is deliberately *asymmetric* — the right leg lands,
 * the left stops short. That gap is the whole product in one shape: the order is
 * sealed to everyone, and openable by exactly one person. The body carries a
 * keyhole that doubles as a commitment slot.
 *
 * Built on a 256 grid with 8px rhythm so it stays crisp from 16px to a banner.
 * `--dorr-brand` lets a surface override the blue without touching the geometry.
 */
export function DorrMark({
  title,
  ...props
}: SVGProps<SVGSVGElement> & { title?: string }) {
  return (
    <svg
      viewBox="0 0 256 256"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? "img" : "presentation"}
      aria-hidden={title ? undefined : true}
      className="w-8 h-8"
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id="dorr-body" x1="40" y1="112" x2="216" y2="232" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--dorr-brand, #2C6BFF)" />
          <stop offset="100%" stopColor="var(--dorr-brand-deep, #0344DC)" />
        </linearGradient>
        <linearGradient id="dorr-shackle" x1="128" y1="24" x2="128" y2="120" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="var(--dorr-brand-light, #7AA6FF)" />
          <stop offset="100%" stopColor="var(--dorr-brand, #2C6BFF)" />
        </linearGradient>
      </defs>

      {/* Shackle — the right leg seats into the body, the left stops short. */}
      <path
        d="M84 116V78a44 44 0 0 1 88 0v38"
        fill="none"
        stroke="url(#dorr-shackle)"
        strokeWidth="24"
        strokeLinecap="round"
        pathLength="100"
        strokeDasharray="86 100"
        strokeDashoffset="-7"
      />

      {/* Body */}
      <rect x="40" y="112" width="176" height="120" rx="34" fill="url(#dorr-body)" />

      {/* Keyhole: a commitment slot — round head, tapered stem. */}
      <path
        d="M128 146a15 15 0 0 1 8.4 27.4l5.1 24.1a5 5 0 0 1-4.9 6.1h-17.2a5 5 0 0 1-4.9-6.1l5.1-24.1A15 15 0 0 1 128 146Z"
        fill="#fff"
        fillOpacity="0.96"
      />
    </svg>
  );
}

/**
 * Mark + wordmark lockup. `dorr` is set lowercase and tight — the product is a
 * terminal, not a bank.
 */
export function DorrLogo({
  className = "",
  markClassName = "w-8 h-8",
  wordClassName = "text-2xl",
  tagline,
}: {
  className?: string;
  markClassName?: string;
  wordClassName?: string;
  tagline?: string;
}) {
  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <DorrMark className={markClassName} title="dorr" />
      <div className="flex flex-col leading-none">
        <span className={`font-semibold lowercase tracking-tight leading-none ${wordClassName}`}>
          dorr
        </span>
        {tagline ? (
          <span className="mt-1 text-[9px] uppercase tracking-[0.2em] text-white/40">{tagline}</span>
        ) : null}
      </div>
    </div>
  );
}

export default DorrMark;
