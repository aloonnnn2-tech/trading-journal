"use client";

import { motion, type HTMLMotionProps } from "framer-motion";
import { staggerContainer } from "@/components/motion/variants";

export function StaggerGrid({ className = "", ...props }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      variants={staggerContainer()}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-40px" }}
      className={className}
      {...props}
    />
  );
}
