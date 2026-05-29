import React from 'react';

interface ActionButtonProps {
  onClick: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'neutral';
  disabled?: boolean;
  isLoading?: boolean;
  className?: string;
}

export const ActionButton: React.FC<ActionButtonProps> = ({
  onClick,
  children,
  variant = 'neutral',
  disabled = false,
  isLoading = false,
  className = '',
}) => {
  const base = 'relative overflow-hidden px-6 py-4 rounded-xl font-bold text-lg shadow-lg transform transition-all duration-300 active:scale-95 hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center justify-center gap-2 group';

  const colors: Record<string, string> = {
    secondary: 'bg-[#640D14] text-white hover:bg-[#500a10]',
    primary:   'bg-[#FEFAE0] text-vinya-secondary border-2 border-vinya-secondary hover:brightness-95',
    neutral:   'bg-gray-800 text-white hover:bg-gray-900',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled || isLoading}
      className={`${base} ${colors[variant] ?? colors.neutral} ${className}`}
    >
      {/* Shine overlay */}
      <div className="absolute inset-0 -translate-x-full group-hover:animate-shimmer bg-gradient-to-r from-transparent via-white/40 to-transparent z-0 pointer-events-none" />

      <span className="relative z-10 flex items-center justify-center gap-2 w-full">
        {isLoading ? (
          <>
            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Chargement...
          </>
        ) : children}
      </span>
    </button>
  );
};
