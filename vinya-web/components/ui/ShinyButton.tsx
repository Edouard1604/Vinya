import React from "react";
import { motion, type AnimationProps } from "framer-motion";

const animationProps: AnimationProps = {
  initial: { "--x": "100%", scale: 0.8 } as any,
  animate: { "--x": "-100%", scale: 1 } as any,
  whileTap: { scale: 0.95 } as any,
  transition: {
    repeat: Infinity,
    repeatType: "loop",
    repeatDelay: 1,
    type: "spring",
    stiffness: 20,
    damping: 15,
    mass: 2,
    scale: {
      type: "spring",
      stiffness: 200,
      damping: 5,
      mass: 0.5,
    },
  },
};

interface ShinyButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  className?: string;
}

/**
 * ShinyButton — effet de reflet lumineux animé en boucle.
 * Conserve le style existant via className ; ajoute uniquement l'animation.
 */
export const ShinyButton: React.FC<ShinyButtonProps> = ({
  children,
  className = "",
  ...props
}) => {
  return (
    <motion.button
      {...(animationProps as any)}
      {...props}
      className={`relative overflow-hidden ${className}`}
    >
      {/* Texte avec masque de reflet */}
      <span
        className="relative z-10 flex items-center justify-center gap-2 w-full"
        style={{
          maskImage:
            "linear-gradient(-75deg, #640D14 calc(var(--x) + 20%), transparent calc(var(--x) + 30%), #640D14 calc(var(--x) + 100%))",
          WebkitMaskImage:
            "linear-gradient(-75deg, #640D14 calc(var(--x) + 20%), transparent calc(var(--x) + 30%), #640D14 calc(var(--x) + 100%))",
        }}
      >
        {children}
      </span>

      {/* Trait lumineux qui passe en boucle */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-0 z-20 rounded-[inherit] p-px"
        style={{
          background:
            "linear-gradient(-75deg, transparent calc(var(--x) + 20%), rgba(100,13,20,0.35) calc(var(--x) + 25%), transparent calc(var(--x) + 100%))",
          mask: "linear-gradient(#000,#000) content-box, linear-gradient(#000,#000)",
          maskComposite: "exclude",
          WebkitMaskComposite: "destination-out",
        }}
      />
    </motion.button>
  );
};

export default ShinyButton;
