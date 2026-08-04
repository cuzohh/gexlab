"use client";

import { motion, useReducedMotion } from "motion/react";

const events = [
  { day: "TODAY", label: "Post-close", detail: "Fresh options snapshot", tone: "neutral" },
  { day: "SUN", label: "Futures open", detail: "6:00 PM ET", tone: "neutral" },
  { day: "MON", label: "Treasury auctions", detail: "Moderate impact", tone: "caution" },
  { day: "TUE", label: "CPI", detail: "8:30 AM · high impact", tone: "stress" },
  { day: "FRI", label: "Monthly expiry", detail: "Settlement risk", tone: "caution" },
] as const;

export function EventRunway() {
  const reducedMotion = useReducedMotion();

  return (
    <motion.section
      className="event-runway"
      initial={reducedMotion ? false : "hidden"}
      whileInView="visible"
      viewport={{ once: true, amount: 0.28 }}
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.08 } },
      }}
    >
      <div className="section-heading">
        <div>
          <p className="section-kicker">Event runway</p>
          <h2>What can disturb the map?</h2>
        </div>
      </div>

      <div className="runway-track">
        {events.map((event, index) => (
          <motion.article
            className="runway-event"
            key={`${event.day}-${event.label}`}
            variants={{
              hidden: { opacity: 0, y: 6 },
              visible: { opacity: 1, y: 0, transition: { duration: 0.38, ease: [0.16, 1, 0.3, 1] } },
            }}
          >
            <motion.span
              className={`runway-node runway-node--${event.tone}`}
              aria-hidden="true"
              variants={{ hidden: { scale: 0.5 }, visible: { scale: 1 } }}
            />
            <p className="runway-day">{event.day}</p>
            <h3>{event.label}</h3>
            <p>{event.detail}</p>
            {index < events.length - 1 ? (
              <motion.i
                className="runway-line"
                aria-hidden="true"
                style={{ transformOrigin: "left center" }}
                variants={{ hidden: { scaleX: 0 }, visible: { scaleX: 1 } }}
              />
            ) : null}
          </motion.article>
        ))}
      </div>
    </motion.section>
  );
}
