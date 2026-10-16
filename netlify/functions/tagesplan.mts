import type { Config } from "@netlify/functions";
import { tagesplanSenden } from "../lib/tagesplan.ts";

// Jeden Abend um 23 Uhr (Berlin): Tagesplan für morgen an hallo@ab-gemacht.info.
// Läuft um 21 und 22 Uhr UTC und sendet nur, wenn es in Berlin 23 Uhr ist (Sommer- und Winterzeit).
export default async () => {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(new Date()));
  if (h !== 23) return;
  try { console.log("Tagesplan gesendet:", await tagesplanSenden()); } catch (e) { console.error("Tagesplan", String(e)); }
};

export const config: Config = { schedule: "0 21,22 * * *" };
