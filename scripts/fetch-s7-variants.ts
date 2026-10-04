import { mkdirSync, writeFileSync } from "node:fs";

/**
 * Downloads the S7 Kraków–Myślenice route variants (A–F) from GDDKiA's STEŚ qgis2web maps
 * and writes compact GeoJSON files to public/data/s7/<variant>.geojson.
 * Source: https://wariant-w<x>.s7-krakow-myslenice-stes.pl/ (© GDDKiA, STEŚ 2025).
 * Usage: pnpm s7:fetch
 */
const VARIANTS = ["a", "b", "c", "d", "e", "f"] as const;

/** qgis2web layer base name (without the _NN suffix, which differs per variant) → feature kind in our overlay. */
const LAYERS: Record<string, { kind: string; maxKb?: number }> = {
  otrasyS7: { kind: "axis" },
  otrasyS7wtunelu: { kind: "axisTunnel" },
  otrasyBDI: { kind: "bdi" },
  otrasyBDIwtunelu: { kind: "bdiTunnel" },
  projektowanetunele: { kind: "tunnel" },
  projektowaneestakadyimosty: { kind: "bridge" },
  proponowanalokalizacjawzwdrogowych: { kind: "interchange" },
  nazwywzwdrogowych: { kind: "interchangeName" },
  schematizakresbudowylubprzebudowy: { kind: "extent", maxKb: 400 },
  kilometraco1km: { kind: "km" },
};

const UA = "land-finder/1.0 (+https://github.com/JanKozub/land-finder)";

/** Reads the variant's index page and returns layer file names keyed by base name. */
async function discoverLayers(variant: string): Promise<Map<string, string>> {
  const res = await fetch(`https://wariant-w${variant}.s7-krakow-myslenice-stes.pl/`, { headers: { "User-Agent": UA } });
  if (res.status !== 200) throw new Error(`variant ${variant}: index HTTP ${res.status}`);
  const html = await res.text();
  const found = new Map<string, string>();
  for (const m of html.matchAll(/src="layers\/([A-Za-z0-9]+?)_(\d+)\.js"/g)) found.set(m[1]!, `${m[1]}_${m[2]}`);
  return found;
}

type Geometry = { type: string; coordinates: unknown };
type Feature = { type: "Feature"; properties: Record<string, unknown>; geometry: Geometry | null };

function roundCoords(c: unknown): unknown {
  if (Array.isArray(c)) {
    if (c.length >= 2 && typeof c[0] === "number" && typeof c[1] === "number") return [Math.round(c[0] * 1e6) / 1e6, Math.round(c[1] * 1e6) / 1e6];
    return c.map(roundCoords);
  }
  return c;
}

async function fetchLayer(variant: string, layer: string): Promise<Feature[] | null> {
  const url = `https://wariant-w${variant}.s7-krakow-myslenice-stes.pl/layers/${layer}.js`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (res.status !== 200) {
    console.warn(`${variant}/${layer}: HTTP ${res.status}`);
    return null;
  }
  const text = await res.text();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  const json = JSON.parse(text.slice(start, end + 1)) as { features?: Feature[] };
  return json.features ?? [];
}

async function main() {
  mkdirSync("public/data/s7", { recursive: true });
  const index: Record<string, { file: string; kinds: Record<string, number>; interchanges: string[]; bytes: number }> = {};
  for (const variant of VARIANTS) {
    const out: Feature[] = [];
    const kinds: Record<string, number> = {};
    const interchanges: string[] = [];
    const available = await discoverLayers(variant);
    for (const [base, cfg] of Object.entries(LAYERS)) {
      const layer = available.get(base);
      if (!layer) {
        console.warn(`${variant}: no layer ${base} (ok for variants without BDI)`);
        continue;
      }
      const feats = await fetchLayer(variant, layer);
      if (!feats) continue;
      const mapped: Feature[] = feats
        .filter((f) => f.geometry)
        .map((f) => {
          const props: Record<string, unknown> = { variant: variant.toUpperCase(), kind: cfg.kind };
          const name = f.properties?.nazwaWezla ?? f.properties?.Text;
          if (typeof name === "string" && name.trim()) props.name = name.trim();
          return { type: "Feature", properties: props, geometry: { type: f.geometry!.type, coordinates: roundCoords(f.geometry!.coordinates) } };
        });
      const size = JSON.stringify(mapped).length / 1024;
      if (cfg.maxKb && size > cfg.maxKb) {
        console.warn(`${variant}/${layer}: ${Math.round(size)} KB > ${cfg.maxKb} KB, skipped`);
        continue;
      }
      kinds[cfg.kind] = mapped.length;
      if (cfg.kind === "interchangeName") for (const f of mapped) if (typeof f.properties.name === "string") interchanges.push(f.properties.name);
      out.push(...mapped);
      await new Promise((r) => setTimeout(r, 300));
    }
    const fc = { type: "FeatureCollection", features: out, attribution: "© GDDKiA — STEŚ S7 Kraków–Myślenice (2025), warianty A–F" };
    const file = `public/data/s7/${variant}.geojson`;
    const body = JSON.stringify(fc);
    writeFileSync(file, body);
    index[variant.toUpperCase()] = { file: `/data/s7/${variant}.geojson`, kinds, interchanges, bytes: body.length };
    console.log(`${variant.toUpperCase()}: ${Math.round(body.length / 1024)} KB`, kinds);
  }
  writeFileSync("public/data/s7/index.json", JSON.stringify({ generatedAt: new Date().toISOString(), source: "https://s7-krakow-myslenice-stes.gddkia.gov.pl/", variants: index }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
