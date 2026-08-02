"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from "motion/react";
import { useState } from "react";

const workspaces = [
  { href: "/", label: "Macro", paths: ["/", "/regime", "/history"] },
  { href: "/structure", label: "Options", paths: ["/structure"] },
  { href: "/reversal-zones", label: "Reversal", paths: ["/reversal-zones"] },
  { href: "/engine", label: "Engine", paths: ["/engine"] },
];

const macroCategories = [
  { href: "/", label: "Overview" },
  { href: "/regime", label: "Regime" },
  { href: "/history", label: "History" },
];

const engineCategories = [{ href: "/engine", label: "Next session" }];
const reversalCategories = [{ href: "/reversal-zones", label: "Confluence" }];

const optionsCategories = [
  { href: "/structure#exposure", label: "Exposure", study: "exposure" },
  { href: "/structure#research", label: "Levels", study: "levels" },
  { href: "/structure#research", label: "Chain", study: "chain" },
  { href: "/structure#research", label: "Volatility", study: "volatility" },
  { href: "/structure#research", label: "Term", study: "term" },
  { href: "/structure#research", label: "Indicator", study: "indicator" },
];

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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const inOptions = pathname.startsWith("/structure");
  const inReversal = pathname.startsWith("/reversal-zones");
  const inEngine = pathname.startsWith("/engine");
  const workspaceName = inOptions ? "Options" : inReversal ? "Reversal" : inEngine ? "Engine" : "Macro";
  const categories = inOptions ? optionsCategories : inReversal ? reversalCategories : inEngine ? engineCategories : macroCategories;
  const [optionCategory, setOptionCategory] = useState("exposure");
  const reducedMotion = useReducedMotion();
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    typeof document !== "undefined" && document.documentElement.dataset.theme === "dark" ? "dark" : "light",
  );

  function toggleTheme() {
    const next = document.documentElement.dataset.theme !== "dark";
    document.documentElement.dataset.theme = next ? "dark" : "light";
    localStorage.setItem("gexlab-v3:theme", next ? "dark" : "light");
    setTheme(next ? "dark" : "light");
  }

  return (
    <MotionConfig reducedMotion={reducedMotion ? "always" : "user"}>
      <div className="app-frame">
      <header className="site-header">
        <Link href="/" className="brand" aria-label="GEXLab V3 home">
          <span className="brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>GEXLAB</span>
          <small>V3</small>
        </Link>

        <nav className="workspace-nav" aria-label="Primary workspace">
          {workspaces.map((item) => {
            const active = item.paths.some((path) => path === pathname);
            return (
              <Link key={item.href} href={item.href} data-active={active || undefined}>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <nav className="category-nav" aria-label={`${workspaceName} categories`}>
          <span>{workspaceName} index</span>
          {categories.map((item) => {
            const path = item.href.split("#")[0];
            const active = !inOptions && (path === "/" ? pathname === "/" : pathname === path);
            return (
              <Link
                key={`${item.href}-${item.label}`}
                href={item.href}
                data-active={(active || (inOptions && "study" in item && optionCategory === item.study)) || undefined}
                onClick={() => {
                  if (inOptions && "study" in item) {
                    const study = String(item.study);
                    setOptionCategory(study);
                    window.dispatchEvent(new CustomEvent("gexlab:study", { detail: study }));
                  }
                }}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="header-tools">
          <span className="preview-status">
            <i aria-hidden="true" />
            {inOptions || inReversal ? "Market data" : inEngine ? "Model output" : "Macro data"}
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

      <AnimatePresence mode="wait" initial={false}>
        <motion.main
          key={pathname}
          initial={false}
          animate={{ opacity: 1, y: 0 }}
          exit={reducedMotion ? { opacity: 1, y: 0 } : { opacity: 0, y: -4 }}
          transition={reducedMotion ? { duration: 0 } : { duration: 0.36, ease: [0.16, 1, 0.3, 1] }}
        >
          {children}
        </motion.main>
      </AnimatePresence>

      <footer className="site-footer">
        <p>Market context, clearly mapped.</p>
        <p>Observed data + labeled models · Not investment advice</p>
      </footer>
      </div>
    </MotionConfig>
  );
}
