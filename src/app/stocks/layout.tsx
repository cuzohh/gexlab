/**
 * The equity workspace loads its own stylesheet.
 *
 * Keeping it here rather than in globals.css means the macro, options, engine,
 * and reversal routes never download these rules.
 */
import "./stocks.css";

export default function StocksLayout({ children }: { children: React.ReactNode }) {
  return children;
}
