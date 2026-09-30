"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
  useScroll,
  useSpring,
} from "motion/react";
import { useEffect, useState } from "react";

const StructureRail = dynamic(
  () => import("@/components/structure-rail").then((module) => module.StructureRail),
  { ssr: false },
);

const workspaces = [
  { href: "/", label: "Macro", paths: ["/", "/regime", "/history"] },
  { href: "/structure", label: "Options", paths: ["/structure"] },
  { href: "/reversal-zones", label: "Reversal", paths: ["/reversal-zones"] },
  { href: "/engine", label: "Engine", paths: ["/engine"] },
  { href: "/stocks", label: "Stocks", paths: ["/stocks"] },
];

const macroCategories = [
  { href: "/", label: "Overview" },
  { href: "/regime", label: "Regime" },
  { href: "/history", label: "History" },
];

// The Engine page runs to roughly eight thousand pixels of tables. One index
// entry for all of it meant no way to reach a section, and no way to send
// someone to one. Each entry addresses a section of the page and lights up as
// that section passes under the reader.
const engineCategories = [
  { href: "/engine#forecast", label: "Next session", section: "forecast" },
  { href: "/engine#behavior", label: "Behavior", section: "behavior" },
  { href: "/engine#context", label: "Around the map", section: "context" },
  { href: "/engine#move-size", label: "Move size", section: "move-size" },
  { href: "/engine#scoring", label: "Scoring", section: "scoring" },
  { href: "/engine#states", label: "States", section: "states" },
  { href: "/engine#recorder", label: "Recorder", section: "recorder" },
  { href: "/engine#log", label: "Forecast log", section: "log" },
];
const reversalCategories = [{ href: "/reversal-zones", label: "Confluence" }];

/** Second key of the "g" chord, one per workspace. */
const WORKSPACE_KEYS: Record<string, string> = {
  m: "/",
  o: "/structure",
  r: "/reversal-zones",
  e: "/engine",
  s: "/stocks",
};

const optionsCategories = [
  { href: "/structure#exposure", label: "Exposure", study: "exposure" },
  { href: "/structure#research", label: "Topologies", study: "topology" },
  { href: "/structure#research", label: "Levels", study: "levels" },
  { href: "/structure#research", label: "Chain", study: "chain" },
  { href: "/structure#research", label: "Volatility", study: "volatility" },
  { href: "/structure#research", label: "Term", study: "term" },
  { href: "/structure#research", label: "Indicator", study: "indicator" },
];

function BrandGlyph() {
  const reducedMotion = useReducedMotion();
  return (
    <motion.svg
      aria-hidden="true"
      className="brand-glyph"
      viewBox="0 0 32 32"
      initial={reducedMotion ? false : { opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: reducedMotion ? 0 : 0.45, ease: [0.16, 1, 0.3, 1] }}
    >
      <rect x="1" y="1" width="30" height="30" rx="7" />
      <path d="M7 21.5h4l2.1-10 3.7 14 2.6-9h5.6" />
      <motion.circle
        cx="24.8"
        cy="16.5"
        r="1.7"
        animate={reducedMotion ? undefined : { opacity: [0.45, 1, 0.45] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
    </motion.svg>
  );
}

/**
 * The reading bar, for browsers that cannot drive one off a scroll timeline.
 *
 * This is the original implementation and it is accurate, but measuring the
 * scroll from script means the browser lays the document out synchronously
 * whenever the page's height changes. On the options workspace, where three
 * large payloads land one after another and each one grows the page, that came
 * to 234ms of layout — two thirds of everything that route spent laying out.
 *
 * Where `scroll()` exists the same bar is a CSS animation the compositor
 * advances on its own, which costs no layout at all. It is kept in its own
 * component so that the hooks behind it are never mounted when unused.
 */
function MeasuredReadingProgress({ reducedMotion }: { reducedMotion: boolean | null }) {
  const { scrollYProgress } = useScroll();
  const readingProgress = useSpring(scrollYProgress, {
    stiffness: 260,
    damping: 34,
    mass: 0.25,
  });
  return (
    <motion.div
      aria-hidden="true"
      className="reading-progress"
      style={{ scaleX: reducedMotion ? scrollYProgress : readingProgress }}
    />
  );
}

function ThemeMark({ theme }: { theme: "light" | "dark" }) {
  return (
    <motion.svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="17"
      height="17"
      animate={{ rotate: theme === "dark" ? 180 : 0, scale: theme === "dark" ? 0.92 : 1 }}
      transition={{ duration: 0.42, ease: [0.16, 1, 0.3, 1] }}
    >
      <circle cx="12" cy="12" r="4.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.46 5.46l1.42 1.42M17.12 17.12l1.42 1.42M18.54 5.46l-1.42 1.42M6.88 17.12l-1.42 1.42"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </motion.svg>
  );
}

/**
 * Which of the given sections is currently being read.
 *
 * The last section whose top has passed a reading line a third of the way down
 * the viewport, measured on scroll rather than by intersection. Intersection
 * was the first attempt and it does not work on this page: the scoring tables
 * run about four thousand pixels, so that one section intersects any sensible
 * band for most of the page and every section after it was unreachable. Where
 * sections are unequal in height and some are nested, position is the question
 * being asked, and position is what this measures.
 *
 * An empty list attaches no listener, so pages without sections pay nothing.
 */
function useSectionSpy(ids: string[]) {
  const key = ids.join(",");
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = key ? key.split(",") : [];
    if (!sections.length) return;

    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight * 0.33;
      let current: string | null = null;
      let best = -Infinity;
      for (const id of sections) {
        const element = document.getElementById(id);
        if (!element) continue;
        const top = element.getBoundingClientRect().top;
        // The closest section at or above the line; failing that, the nearest
        // one still below it, so the first section is active at the top of the
        // page rather than nothing being marked at all.
        const score = top <= line ? top : -Infinity;
        if (score > best) {
          best = score;
          current = id;
        }
      }
      setActive(current ?? sections[0]);
    };

    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [key]);

  return active;
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const inOptions = pathname.startsWith("/structure");
  const inReversal = pathname.startsWith("/reversal-zones");
  const inEngine = pathname.startsWith("/engine");
  const inStocks = pathname.startsWith("/stocks");
  const workspaceName = inOptions ? "Options" : inReversal ? "Reversal" : inEngine ? "Engine" : inStocks ? "Stocks" : "Macro";
  // The equity workspace carries its own view tabs on the detail route, so a
  // rail index for it was a single entry pointing at the page already open.
  const categories = inOptions ? optionsCategories : inReversal ? reversalCategories : inEngine ? engineCategories : inStocks ? [] : macroCategories;
  const [optionCategory, setOptionCategory] = useState("exposure");
  const sectionIds = categories
    .map((item) => ("section" in item ? String(item.section) : null))
    .filter((id): id is string => id !== null);
  const activeSection = useSectionSpy(inEngine ? sectionIds : []);
  const reducedMotion = useReducedMotion();
  // Whether the browser can drive the reading bar off a scroll timeline. Read
  // after mount so the server and the first client render agree; the CSS path
  // is what both produce, and only a browser without scroll timelines swaps in
  // the measured one.
  const [needsMeasuredProgress, setNeedsMeasuredProgress] = useState(false);
  useEffect(() => {
    const supported =
      typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("animation-timeline: scroll()");
    // Deferred a tick, as the rest of this file does: the server renders the
    // CSS bar and hydration has to agree with it before the swap.
    if (!supported) queueMicrotask(() => setNeedsMeasuredProgress(true));
  }, []);
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  function toggleTheme() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("gexlab-v3:theme", next ? "dark" : "light");
    setTheme(next ? "dark" : "light");
  }

  const [showShortcuts, setShowShortcuts] = useState(false);

  // Keyboard navigation. Four workspaces and seven studies, all of them a mouse
  // trip to the rail away, is the difference between a site and a terminal.
  // "g" opens a chord in the vim tradition rather than binding bare letters,
  // which would fire on any stray keypress; the study digits are unprefixed
  // because they only mean anything inside the Options workspace.
  useEffect(() => {
    let awaitingChord = false;
    let chordTimer = 0;

    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)
      );
    };

    // The study travels with the entry rather than being looked up from its
    // href: every study below Exposure shares "/structure#research", so a
    // lookup by href resolved all five of them to Levels.
    const go = (entry: (typeof optionsCategories)[number]) => {
      setOptionCategory(entry.study);
      window.dispatchEvent(new CustomEvent("gexlab:study", { detail: entry.study }));
      router.push(entry.href);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTyping(event.target)) return;

      if (event.key === "Escape") {
        setShowShortcuts(false);
        awaitingChord = false;
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setShowShortcuts((open) => !open);
        return;
      }

      if (awaitingChord) {
        window.clearTimeout(chordTimer);
        awaitingChord = false;
        const destination = WORKSPACE_KEYS[event.key.toLowerCase()];
        if (destination) {
          event.preventDefault();
          router.push(destination);
        }
        return;
      }

      if (event.key.toLowerCase() === "g") {
        awaitingChord = true;
        // The chord lapses so a "g" typed for its own sake does not silently
        // arm a navigation that fires on whatever is pressed minutes later.
        chordTimer = window.setTimeout(() => {
          awaitingChord = false;
        }, 1500);
        return;
      }

      if (inOptions && /^[1-7]$/.test(event.key)) {
        const target = optionsCategories[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          go(target);
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(chordTimer);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [inOptions, router]);

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      <div className="app-frame">
      {needsMeasuredProgress ? <MeasuredReadingProgress reducedMotion={reducedMotion} /> : (
        <div aria-hidden="true" className="reading-progress" />
      )}
      <header className="site-header">
        <Link href="/" className="brand" aria-label="GEXLab V3 home">
          <BrandGlyph />
          <span className="brand-lockup"><span>GEXLAB</span><small>MARKET DESK · V3</small></span>
        </Link>

        <nav className="workspace-nav" aria-label="Primary workspace">
          {workspaces.map((item) => {
            const active = item.paths.some((path) => path === pathname);
            return (
              <Link key={item.href} href={item.href} data-active={active || undefined} aria-current={active ? "page" : undefined}>
                <span>{item.label}</span>
                {active ? <motion.i className="workspace-active-mark" layoutId="workspace-active" /> : null}
              </Link>
            );
          })}
        </nav>

        {categories.length > 0 ? (
        <nav className="category-nav" aria-label={`${workspaceName} categories`}>
          <span>{workspaceName} index</span>
          {categories.map((item) => {
            const path = item.href.split("#")[0];
            // Three kinds of entry: a section of the current page, a study the
            // Options workspace switches between, and a plain route.
            const isSection = "section" in item;
            const active = isSection
              ? activeSection === item.section
              : inOptions && "study" in item
                ? optionCategory === item.study
                : !inOptions && (path === "/" ? pathname === "/" : pathname === path);
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                data-active={active || undefined}
                onClick={() => {
                  if (inOptions && "study" in item) {
                    const study = String(item.study);
                    setOptionCategory(study);
                    window.dispatchEvent(new CustomEvent("gexlab:study", { detail: study }));
                  }
                }}
              >
                <span>{item.label}</span>
                {active ? <motion.i className="category-active-mark" layoutId="category-active" /> : null}
              </Link>
            );
          })}
        </nav>
        ) : null}

        {(inOptions || inReversal) && <StructureRail />}

        <div className="header-tools">
          <span className="preview-status">
            <i aria-hidden="true" />
            {inOptions || inReversal ? "Market data" : inEngine ? "Model output" : inStocks ? "Equity data" : "Macro data"}
          </span>
          <button
            className="theme-toggle"
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle light and dark theme"
          >
            <motion.span whileHover={{ scale: 1.06 }} whileTap={{ scale: 0.9 }}>
              <ThemeMark theme={theme} />
            </motion.span>
          </button>
        </div>
      </header>

      <AnimatePresence mode="sync" initial={false}>
        <motion.main
          key={pathname}
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -2 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
      </AnimatePresence>

      <AnimatePresence>
        {showShortcuts ? (
          <motion.div
            className="shortcut-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="Keyboard shortcuts"
            initial={reducedMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.16 }}
            onClick={() => setShowShortcuts(false)}
          >
            <motion.div
              className="shortcut-card"
              initial={reducedMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
              transition={{ duration: reducedMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
              onClick={(event) => event.stopPropagation()}
            >
              <p className="section-kicker">Keyboard</p>
              <h2>Shortcuts</h2>
              <dl>
                <div>
                  <dt><kbd>g</kbd> <kbd>m</kbd></dt>
                  <dd>Macro</dd>
                </div>
                <div>
                  <dt><kbd>g</kbd> <kbd>o</kbd></dt>
                  <dd>Options</dd>
                </div>
                <div>
                  <dt><kbd>g</kbd> <kbd>r</kbd></dt>
                  <dd>Reversal</dd>
                </div>
                <div>
                  <dt><kbd>g</kbd> <kbd>e</kbd></dt>
                  <dd>Engine</dd>
                </div>
                <div>
                  <dt><kbd>g</kbd> <kbd>s</kbd></dt>
                  <dd>Stocks</dd>
                </div>
                <div>
                  <dt><kbd>1</kbd>–<kbd>7</kbd></dt>
                  <dd>Options study: exposure, topologies, levels, chain, volatility, term, indicator</dd>
                </div>
                <div>
                  <dt><kbd>?</kbd></dt>
                  <dd>This list</dd>
                </div>
                <div>
                  <dt><kbd>Esc</kbd></dt>
                  <dd>Close</dd>
                </div>
              </dl>
              <button type="button" onClick={() => setShowShortcuts(false)}>Close</button>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <footer className="site-footer">
        <p>Not investment advice</p>
        <button className="shortcut-hint" type="button" onClick={() => setShowShortcuts(true)}>
          <kbd>?</kbd> shortcuts
        </button>
      </footer>
      </div>
    </MotionConfig>
  );
}
