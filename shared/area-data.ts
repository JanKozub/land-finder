import type { GminaRecord } from "./area";
import gminyFile from "./data/gminy.json";

/** Gmina boundaries around Wieliczka (OpenStreetMap, `pnpm gminy:fetch`); ~220 KB, import lazily on the client. */
const file = gminyFile as unknown as { gminy: GminaRecord[]; attribution: string };
export const GMINY: GminaRecord[] = file.gminy;
export const GMINY_ATTRIBUTION = file.attribution;
