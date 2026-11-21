import { useId } from 'react';

/** The Voris mark: a converging "V" with a spark at its origin. */
export function LogoMark({ size = 28, className = '' }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={`vg-${id}`} x1="8" y1="10" x2="56" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b69cff" />
          <stop offset="0.55" stopColor="#7c6cff" />
          <stop offset="1" stopColor="#4f8bff" />
        </linearGradient>
        <linearGradient id={`vb-${id}`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1a1630" />
          <stop offset="1" stopColor="#0f1426" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="62" height="62" rx="17" fill={`url(#vb-${id})`} stroke="rgba(255,255,255,0.09)" strokeWidth="1.5" />
      <path d="M16 19 L32 46 L48 19" stroke={`url(#vg-${id})`} strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M24.5 19 L32 31.5" stroke="rgba(255,255,255,0.22)" strokeWidth="3" strokeLinecap="round" />
      <circle cx="48" cy="19" r="4.6" fill="#d9ceff" />
    </svg>
  );
}

export function Logo({ size = 28, showText = true }: { size?: number; showText?: boolean }) {
  return (
    <span className="logo">
      <LogoMark size={size} />
      {showText && (
        <span className="logo-text">
          Voris<span className="logo-ai">AI</span>
        </span>
      )}
    </span>
  );
}
