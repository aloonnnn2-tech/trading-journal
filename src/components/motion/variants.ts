import type { Variants } from "framer-motion";

export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0 },
};

export function staggerContainer(stagger = 0.06): Variants {
  return {
    hidden: {},
    show: { transition: { staggerChildren: stagger } },
  };
}
