"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";

type OrientationHeroProps = {
  eyebrow: string;
  question: string;
  answer: string;
  detail: string;
  confidence?: number;
  confidenceLabel?: string;
  caveat: string;
};

export function OrientationHero({
  eyebrow,
  question,
  answer,
  detail,
  confidence,
  confidenceLabel = "Signal agreement",
  caveat,
}: OrientationHeroProps) {
  const reducedMotion = useReducedMotion();
  const enter = reducedMotion
    ? { duration: 0 }
    : { duration: 0.48, ease: [0.16, 1, 0.3, 1] as const };

  return (
    <motion.section
      className="orientation-hero"
      initial={reducedMotion ? false : "hidden"}
      animate="visible"
      variants={{
        hidden: { opacity: 0 },
        visible: { opacity: 1, transition: { staggerChildren: 0.07 } },
      }}
    >
      <motion.div className="orientation-copy" variants={{ hidden: {}, visible: {} }}>
        <motion.p className="eyebrow" variants={{ hidden: { opacity: 0, y: 5 }, visible: { opacity: 1, y: 0, transition: enter } }}>{eyebrow}</motion.p>
        <motion.p className="orientation-question" variants={{ hidden: { opacity: 0, y: 5 }, visible: { opacity: 1, y: 0, transition: enter } }}>{question}</motion.p>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.h1
            key={answer}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={enter}
          >
            {answer}
          </motion.h1>
        </AnimatePresence>
        <motion.p className="hero-detail" variants={{ hidden: { opacity: 0, y: 5 }, visible: { opacity: 1, y: 0, transition: enter } }}>{detail}</motion.p>
      </motion.div>

      <motion.div
        className="hero-proof"
        aria-label="Reading context"
        initial={reducedMotion ? false : { opacity: 0, x: 8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ ...enter, delay: reducedMotion ? 0 : 0.18 }}
      >
        {confidence !== undefined ? (
          <div className="confidence">
            <div className="confidence-head">
              <span>{confidenceLabel}</span>
              <strong>{confidence}%</strong>
            </div>
            <div
              className="confidence-track"
              role="meter"
              aria-label={`${confidence} percent ${confidenceLabel.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={confidence}
            >
              <motion.i
                key={confidence}
                style={{ width: `${confidence}%`, transformOrigin: "left center" }}
                initial={reducedMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ ...enter, delay: reducedMotion ? 0 : 0.24 }}
              />
            </div>
          </div>
        ) : null}
        <p className="hero-caveat">
          <span>What could change it</span>
          {caveat}
        </p>
      </motion.div>
    </motion.section>
  );
}
