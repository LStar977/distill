export const fmt = (n: number) => Math.round(n).toLocaleString("en-US");

export const pct = (x: number, digits = 1) => `${(x * 100).toFixed(digits)}%`;

export const usd = (x: number) => `$${x.toFixed(2)}`;

export const tok = (x: number) => (x >= 1e6 ? `${(x / 1e6).toFixed(1)}M` : `${Math.round(x / 1e3)}K`);

export const mmss = (t: number) => {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const pad2 = (n: number) => String(n).padStart(2, "0");
export const pad3 = (n: number) => String(n).padStart(3, "0");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-03-14" → "14 Mar 2026" */
export const shortDate = (iso?: string) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

export const secs = (ms: number) => `${Math.round(ms / 1000)}s`;
