# Land Finder — działki i domy w okolicy

Osobista aplikacja, która zbiera oferty sprzedaży **działek i domów** z OLX i Otodom w zadanym promieniu
(domyślnie Wieliczka, 15 km), **usuwa duplikaty**, pokazuje je **na mapie** z filtrami, pozwala **ukrywać**
nieinteresujące oferty i **powiadamia na Telegramie** o nowych. Każde ogłoszenie ma zapisany link do źródła —
przycisk „Otwórz ofertę” jest na liście, w popupie na mapie i w powiadomieniu.

Stack: Vite + React 19 + Tailwind 4 + Leaflet (statyczny SPA) · Netlify Functions (Hono) · Postgres (Supabase)
przez Drizzle ORM · PGlite do lokalnego startu i testów. Kod po angielsku, UI po polsku.

## Szybki start (lokalnie, bez żadnych kont)

```bash
pnpm install
pnpm db:migrate            # tworzy lokalną bazę PGlite w .data/dev (DATABASE_URL domyślnie pglite://.data/dev)
pnpm dev                   # http://localhost:5173 — Vite + emulacja funkcji Netlify (/api/*)
```

W aplikacji: **Pobieranie → „Pobierz nowe oferty”**. Pierwsze pełne zasilenie lepiej zrobić z terminala
(bez limitów czasu, z domowego IP):

```bash
pnpm worker --mode backfill
```

> PGlite jest bazą jednoprocesową: nie uruchamiaj `pnpm worker` równolegle z `pnpm dev` na tej samej bazie
> plikowej. Z Supabase (poniżej) ten problem nie występuje.

## Produkcja: Supabase + Netlify

1. **Supabase** — nowy projekt (region Frankfurt). W *Project settings → Database → Connection string* skopiuj:
   - *Transaction pooler* (port **6543**) → `DATABASE_URL`
   - *Session pooler* (port **5432**) → `DATABASE_URL_MIGRATIONS`
   Bezpośredni host `db.<ref>.supabase.co` jest tylko IPv6 — z Netlify trzeba używać poolera.
2. Lokalnie: `cp .env.example .env`, wklej oba adresy, `pnpm db:migrate`, `pnpm worker --mode backfill`.
3. **Telegram** — u [@BotFather](https://t.me/BotFather) `/newbot` → token. Napisz coś do bota, potem otwórz
   `https://api.telegram.org/bot<TOKEN>/getUpdates` i odczytaj `message.chat.id`. Ustaw `TELEGRAM_BOT_TOKEN`
   i `TELEGRAM_CHAT_ID`. W aplikacji *Ustawienia → Wyślij test*.
4. **Netlify** — podłącz repozytorium, build `pnpm build`, publish `dist` (jest w `netlify.toml`). W panelu ustaw
   zmienne z `.env.example` (co najmniej `DATABASE_URL`, `APP_BASE_URL`, token i chat Telegrama).
   Deploy produkcyjny na planie kredytowym kosztuje 15 kredytów — iteruj na deploy preview (0 kredytów).
5. Po pierwszym deployu sprawdź `GET /api/health` i w logach funkcji, czy OLX odpowiada 200 z IP Netlify.
   Jeśli 403: ustaw `OLX_PROXY_URL` **albo** `WORKER_SOURCES=otodom` na Netlify i pobieraj OLX lokalnie
   (`WORKER_SOURCES=olx pnpm worker --mode incremental`) na tę samą bazę.
6. Harmonogram: funkcja `scrape-tick` budzi się co 30 min (`netlify.toml`); faktyczne pobieranie włączasz w
   *Ustawienia → Automatyczne pobieranie* (interwał, godziny aktywne). Lokalnie: `npx netlify-cli functions:invoke scrape-tick`.

## Jak to działa

- **Kolejka zadań w Postgresie + worker z budżetem czasu** (`server/jobs`). Każde wywołanie (porcja z UI, tick
  harmonogramu, lokalny CLI) przetwarza zadania przez ≤ `SCRAPE_STEP_BUDGET_MS` i zapisuje kursor, więc praca
  jest wznawialna i mieści się w limicie 10 s funkcji Netlify. Jedna blokada (`worker_lease`) — jeden worker naraz.
- **Źródła** (`server/sources`): OLX przez publiczne JSON API (kategorie 24 = działki, 18 = domy; ≥2 s odstępu,
  ≤20 żądań/10 min, backoff po 403). Żądania do OLX idą przez klienta z odciskiem przeglądarki (`got-scraping`,
  nagłówki i TLS jak Chrome), bo CloudFront OLX po serii żądań odrzuca zwykły `fetch` z Node z danego IP, a taki
  klient nadal przechodzi; `OLX_CLIENT=fetch` przywraca zwykły `fetch`. Otodom przez JSON osadzony w stronach
  (`__NEXT_DATA__` / `_next/data`), współrzędne z strony oferty (1 żądanie na nową ofertę, cache w bazie).
- **Obszar poszukiwań** to prostokąt rysowany na mapie w ustawieniach (`settings.area`). Z niego wynika wszystko inne:
  portale z promieniem (OLX, Otodom, Nieruchomosci-online, Domiporta) dostają okrąg obejmujący prostokąt (środek +
  półprzekątna), portale bez promienia (Gratka, Morizon, Adresowo) listę gmin, które prostokąt obejmuje (granice gmin
  z OpenStreetMap w `public/data/gminy.json`, `pnpm gminy:fetch`; slugi generowane z nazw: `gmina-wieliczka`,
  `wielicki/gmina-wieliczka`, `krakow`), a ogłoszenia ze współrzędnymi spoza prostokąta są odrzucane przy pobieraniu
  (z marginesem 1 km / promieniem przybliżenia) lub usuwane po enrich; przycisk „Usuń N ogłoszeń spoza obszaru”
  czyści dane pobrane przed zmianą obszaru. Ustawienia zapytań portali są w całości pochodne i przeliczane przy
  zapisie (`deriveSettingsFromArea`): miasto OLX (id rozwiązywane z nazwy gminy w środku obszaru), ścieżka Otodom
  `malopolskie/<powiat>/<gmina>`, miejscowość Nieruchomosci-online i Domiporty, listy gmin pozostałych; w ustawieniach
  portale tylko się włącza i wyłącza. Pierwsza strona każdego zapytania zapisuje liczbę wyników portalu
  (`source_state.meta.totals`), a zakładka „Pobieranie” pokazuje pokrycie „mamy X z Y” per portal i rodzaj.
  Przebiegi przyrostowe kończą się dopiero po dwóch kolejnych stronach bez nowych ogłoszeń (promowane i odświeżane
  oferty psują kolejność).
- **Pozostałe portale** (`server/sources/<portal>`, ustawienia w zakładce „Ustawienia”, każdy z przełącznikiem):
  - **Nieruchomosci-online** — wyszukiwanie `szukaj.html?3,<dzialka|dom>,sprzedaz,,<Miejscowość:id>,,,<promień>`;
    dane z osadzonego `tilesData` (współrzędne z flagą dokładności) i JSON-LD (powierzchnia); bez kroku enrich.
    Promień liczony od miejscowości, więc część ofert leży dalej niż zadany promień.
  - **Gratka** i **Morizon** — ten sam system (Grupa Morizon-Gratka, wspólne wewnętrzne id ofert), dane z
    `__NUXT_DATA__` (format devalue, dekoder w `server/sources/nuxt.ts`); portal nie obsługuje promienia — lokalizacja
    to powiat/gmina/miasto z adresu (`powiat-wielicki`, `wielicki/gmina-wieliczka`, kilka po przecinku); współrzędne
    (przybliżone, geokodowanie miejscowości) ze strony oferty. Morizon jest domyślnie wyłączony, bo dubluje Gratkę.
  - **Domiporta** — HTML + JSON-LD listy (`?Distance=<km>` działa dla dowolnej liczby), dokładne współrzędne ze
    strony oferty (`itemOffered.geo`).
  - **Adresowo** — oferty prywatne i agencyjne, czysty HTML (karty `[data-offer-card]`), stronicowanie przez
    `<link rel="next">`; lokalizacja to slug z adresu (`powiat-wielicki`, `wieliczka-1` — bez przyrostka portal
    zwraca pusty widok), promień `g<km>` tylko dla miejscowości; współrzędne (przybliżone, ~1 km) i data dodania
    (względna) ze strony oferty.
  Wszystkie korzystają ze zwykłego `fetch` z nagłówkami przeglądarki, limitów ≤ 2 s między żądaniami i tych samych
  kursorów co OLX/Otodom. `pnpm fixtures:record [portale]` nagrywa i przycina prawdziwe odpowiedzi do
  `tests/fixtures/<portal>` (`scripts/lib/trim-fixtures.ts`).
- **Deduplikacja** (`server/dedup`): ogłoszenia → nieruchomości; reguły na współrzędnych (dokładne/przybliżone),
  powierzchni, cenie, podobieństwie tytułu i sprzedawcy. Między portalami dodatkowo: klucze tożsamości ogłoszenia
  (`attributes.dedupKeys`: wspólne id Gratka/Morizon, numery referencyjne agencji z Otodom i Domiporty), nazwa agencji
  porównywana po słowach kluczowych („Bracia Sadurscy – Oddział I” = „Bracia Sadurscy Nieruchomości”), ten sam punkt
  z identyczną ceną i powierzchnią (portale generują własne tytuły), dwie „dokładne” pinezki do 1 km z mocnym
  dowodem oraz luźniejsza tolerancja powierzchni domów (użytkowa vs całkowita) przy tym samym sprzedawcy/tytule.
  `pnpm dedup:report` pokazuje statystyki scaleń i pary nie scalone mimo podobieństwa; `pnpm dedup:reassign`
  przelicza przypisania po zmianie reguł (lokalnie przy zatrzymanym `pnpm dev`; produkcja: `--database-url`).
  Ręcznie: „To nie ta sama oferta” (trwałe wykluczenie) oraz „Scal”.
- **Powiadomienia** (`server/notify`): po zakończeniu przebiegu, paczki po 10, tylko oferty spełniające kryteria
  alertu; pełne zasilenie (`backfill`) nie wysyła powiadomień.
- **Zakładka „Oferty”**: surowa tabela wszystkich ogłoszeń z bazy (`GET /api/listings`) z wyszukiwaniem, filtrami
  źródła/rodzaju/statusu/ignorowania, sortowaniem po kolumnach, stronicowaniem, linkiem do ogłoszenia i do nieruchomości
  na mapie oraz eksportem bieżącej strony do CSV.
- **Ignorowanie ogłoszeń**: kolumna `listings.ignored` (`POST /api/listings/:id/ignore`), przełączana w tabeli ofert
  i w szczegółach nieruchomości. Ignorowane ogłoszenie nie liczy się do danych nieruchomości; gdy wszystkie jej
  ogłoszenia są ignorowane, nieruchomość ma `ignored = true` i znika z mapy oraz powiadomień — pokazuje ją dopiero
  przełącznik „Pokaż ignorowane ogłoszenia” (domyślnie wyłączony). To uzupełnienie „Ukryj”, które działa na całą
  nieruchomość. Z popupu markera i ze szczegółów można zignorować wszystkie ogłoszenia nieruchomości naraz
  (`POST /api/properties/:id/ignore`).
- **Ulubione**: kolumna `properties.favorite` (`POST /api/properties/:id/favorite`), gwiazdka w popupie markera, na
  karcie i w szczegółach; markery ulubionych mają złotą obwódkę. Przełącznik „Tylko ulubione” (domyślnie wyłączony,
  parametr `favorites=only`) zawęża mapę i listę do ulubionych. Przy scalaniu nieruchomości flaga jest zachowywana.
- **Planowana S7 Kraków–Myślenice**: nakładka na mapie z sześcioma wariantami trasy (A–F) ze Studium
  techniczno-ekonomiczno-środowiskowego GDDKiA (2025). Dane to statyczne pliki `public/data/s7/<wariant>.geojson`
  pobrane skryptem `pnpm s7:fetch` z oficjalnych map wariantów (`https://wariant-w<x>.s7-krakow-myslenice-stes.pl/`,
  warstwy qgis2web: oś S7 i odcinki w tunelu, oś BDI, estakady/mosty, tunele, węzły z nazwami, zakres robót,
  kilometraż). Linie mają kolory wariantów jak na mapach GDDKiA; po zbliżeniu (zoom ≥ 13) pojawiają się estakady,
  tunele, węzły i zakres robót. Węzły to klikalne kółka na trasie — kliknięcie pokazuje lub chowa nazwę węzła.
  Przyciski A–F w panelu filtrów włączają warianty
  (parametr `s7=A,C` albo `s7=none`), a filtr „S7” (`s7f=near:500` / `s7f=far:1000`) zawęża oferty do położonych
  blisko lub z dala od osi najbliższego włączonego wariantu. Odległość do osi każdego wariantu liczona jest w
  przeglądarce (`shared/s7.ts`); karta pokazuje najbliższy wariant (plakietka do 150 m = „na trasie”, do 500 m =
  „w pobliżu”), popup i szczegóły — wszystkie warianty.

## Skrypty

| Komenda | Opis |
|---|---|
| `pnpm dev` | Vite + emulacja Netlify Functions |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | build SPA, TypeScript, vitest (PGlite w pamięci) |
| `pnpm db:generate` / `pnpm db:migrate [--database-url …]` / `pnpm db:studio` | migracje Drizzle (bez flagi: `DATABASE_URL_MIGRATIONS`, potem `DATABASE_URL`) |
| `pnpm worker [--mode incremental\|backfill\|sweep] [--sources olx,otodom] [--database-url …]` | lokalny worker; bez `--mode` tylko dokańcza zakolejkowane zadania; `--sources` wybiera portale, które dostają nowe zadania (przy trwającym przebiegu tego samego trybu dołącza je do niego), a kolejka jest zawsze opróżniana w całości |
| `pnpm fixtures:record [olx,otodom,domiporta,adresowo,gratka,morizon,nieruchomosci_online]` | nagrywa i przycina prawdziwe odpowiedzi portali jako fixture'y testów |
| `pnpm s7:fetch` | pobiera warianty planowanej S7 z map GDDKiA do `public/data/s7/*.geojson` |
| `pnpm gminy:fetch` | pobiera granice gmin wokół Wieliczki z OpenStreetMap do `shared/data/gminy.json` |
| `pnpm dedup:report` / `pnpm dedup:reassign [--database-url …]` | statystyki duplikatów między portalami / ponowne scalanie po zmianie reguł |

## Zmienne środowiskowe

Patrz `.env.example`. Najważniejsze: `DATABASE_URL`, `DATABASE_URL_MIGRATIONS`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `APP_BASE_URL`, opcjonalnie `OLX_PROXY_URL`, `WORKER_SOURCES`, `APP_SECRET`
(nagłówek `X-App-Secret` wymagany dla operacji zapisu), `SCRAPE_STEP_BUDGET_MS` (8000; na planie kredytowym
Netlify można 20000).
