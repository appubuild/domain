import React from 'react';

interface VigoLogoProps {
  size?: 'sm' | 'md' | 'lg';
  showBadge?: boolean;
}

export const VigoLogo: React.FC<VigoLogoProps> = ({
  size = 'md',
  showBadge = true,
}) => {
  const dimensions = {
    sm: 'w-8 h-8',
    md: 'w-10 h-10',
    lg: 'w-12 h-12',
  }[size];

  const textSize = {
    sm: 'text-lg',
    md: 'text-xl',
    lg: 'text-2xl',
  }[size];

  return (
    <div className="inline-flex items-center gap-3 group select-none">
      <div className={`relative ${dimensions} flex-shrink-0`}>
        <div className="absolute -inset-1 rounded-2xl bg-gradient-to-tr from-indigo-500 via-violet-500 to-cyan-400 opacity-50 blur-md group-hover:opacity-90 transition-opacity duration-300" />
        <svg
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="relative w-full h-full rounded-xl shadow-lg"
        >
          <defs>
            <linearGradient
              id="vigoLogoBg"
              x1="0"
              y1="0"
              x2="64"
              y2="64"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#0F142C" />
              <stop offset="100%" stopColor="#060814" />
            </linearGradient>
            <linearGradient
              id="vigoLogoStroke"
              x1="8"
              y1="8"
              x2="56"
              y2="56"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#6366F1" />
              <stop offset="50%" stopColor="#8B5CF6" />
              <stop offset="100%" stopColor="#06B6D4" />
            </linearGradient>
            <linearGradient
              id="vigoBolt"
              x1="24"
              y1="14"
              x2="40"
              y2="44"
              gradientUnits="userSpaceOnUse"
            >
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="65%" stopColor="#67E8F9" />
              <stop offset="100%" stopColor="#38BDF8" />
            </linearGradient>
          </defs>
          <rect width="64" height="64" rx="15" fill="url(#vigoLogoBg)" />
          <rect
            x="1.5"
            y="1.5"
            width="61"
            height="61"
            rx="13.5"
            stroke="url(#vigoLogoStroke)"
            strokeOpacity="0.75"
            strokeWidth="2"
          />
          <path
            d="M14 22C14 16.4772 18.4772 12 24 12H40C45.5228 12 50 16.4772 50 22V34C50 39.5228 45.5228 44 40 44H29.5L20.2 51.4C18.9 52.44 17 51.51 17 49.84V43.46C15.14 41.65 14 39.12 14 36.3V22Z"
            fill="url(#vigoLogoStroke)"
            fillOpacity="0.22"
            stroke="url(#vigoLogoStroke)"
            strokeWidth="2.5"
            strokeLinejoin="round"
          />
          <path
            d="M34.5 17L24.5 29.5H32L29.5 39.5L39.5 27H32L34.5 17Z"
            fill="url(#vigoBolt)"
          />
        </svg>
      </div>

      <div className="flex items-center gap-2">
        <span
          className={`font-display font-extrabold tracking-tight text-white ${textSize}`}
        >
          VigoChat
          <span className="text-gradient-vigo">.com</span>
        </span>
        {showBadge && (
          <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            For Sale
          </span>
        )}
      </div>
    </div>
  );
};
