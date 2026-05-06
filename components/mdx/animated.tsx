"use client";

import { motion, useInView, type Variants } from "framer-motion";
import { useRef, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type AnimatedVariant =
  | "fadeUp"
  | "fadeIn"
  | "pop"
  | "slideLeft"
  | "slideRight"
  | "wave";

const variantMap: Record<AnimatedVariant, Variants> = {
  fadeUp: {
    hidden: { opacity: 0, y: 24 },
    show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
  },
  fadeIn: {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { duration: 0.6 } },
  },
  pop: {
    hidden: { opacity: 0, scale: 0.6 },
    show: {
      opacity: 1,
      scale: 1,
      transition: { type: "spring", stiffness: 280, damping: 18 },
    },
  },
  slideLeft: {
    hidden: { opacity: 0, x: 40 },
    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 220, damping: 22 } },
  },
  slideRight: {
    hidden: { opacity: 0, x: -40 },
    show: { opacity: 1, x: 0, transition: { type: "spring", stiffness: 220, damping: 22 } },
  },
  wave: {
    hidden: { opacity: 0, rotate: -8, y: 10 },
    show: {
      opacity: 1,
      rotate: 0,
      y: 0,
      transition: { type: "spring", stiffness: 200, damping: 14 },
    },
  },
};

// Plays a one-shot entrance animation when scrolled into view. Use in MDX
// to give sections, callouts, or images a friendly arrival.
export function Animated({
  variant = "fadeUp",
  delay = 0,
  className,
  children,
}: {
  variant?: AnimatedVariant;
  delay?: number;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      variants={variantMap[variant]}
      transition={{ delay }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// Continuous gentle bounce — great for emojis, big numbers, mascots.
export function Bounce({
  children,
  className,
  amount = 6,
  duration = 1.4,
}: {
  children: ReactNode;
  className?: string;
  amount?: number;
  duration?: number;
}) {
  return (
    <motion.span
      className={cn("inline-block", className)}
      animate={{ y: [0, -amount, 0] }}
      transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
    >
      {children}
    </motion.span>
  );
}

// Wiggles back and forth on hover/tap. Inline by default — wrap an emoji
// or a key word the learner should poke at.
export function Wiggle({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <motion.span
      className={cn("inline-block cursor-pointer", className)}
      whileHover={{ rotate: [0, -8, 8, -6, 6, 0], transition: { duration: 0.5 } }}
      whileTap={{ scale: 0.9, rotate: 8 }}
    >
      {children}
    </motion.span>
  );
}

// Animates direct children one after another. Useful for a list of intro
// sentences or a row of word cards that "land" in sequence.
export function Stagger({
  children,
  delay = 0.1,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "ul" | "ol";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });

  const container: Variants = {
    hidden: {},
    show: { transition: { staggerChildren: delay } },
  };
  const item: Variants = {
    hidden: { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring", stiffness: 240, damping: 22 },
    },
  };

  const MotionTag = as === "ul" ? motion.ul : as === "ol" ? motion.ol : motion.div;
  const ChildTag = as === "ul" || as === "ol" ? motion.li : motion.div;

  return (
    <MotionTag
      ref={ref as React.RefObject<HTMLDivElement & HTMLUListElement & HTMLOListElement>}
      variants={container}
      initial="hidden"
      animate={inView ? "show" : "hidden"}
      className={className}
    >
      {Array.isArray(children)
        ? children.map((child, i) => (
            <ChildTag key={i} variants={item}>
              {child}
            </ChildTag>
          ))
        : <ChildTag variants={item}>{children}</ChildTag>}
    </MotionTag>
  );
}
