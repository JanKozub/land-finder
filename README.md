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
- **Deduplikacja** (`server/dedup`): ogłoszenia → nieruchomości; reguły na współrzędnych (dokładne/przybliżone),
  powierzchni, cenie, podobieństwie tytułu i sprzedawcy. Ręcznie: „To nie ta sama oferta” (trwałe wykluczenie)
  oraz „Scal”.
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

## Skrypty

| Komenda | Opis |
|---|---|
| `pnpm dev` | Vite + emulacja Netlify Functions |
| `pnpm build` / `pnpm typecheck` / `pnpm test` | build SPA, TypeScript, vitest (PGlite w pamięci) |
| `pnpm db:generate` / `pnpm db:migrate` / `pnpm db:studio` | migracje Drizzle |
| `pnpm worker --mode incremental\|backfill\|sweep [--sources olx,otodom]` | lokalny worker |
| `pnpm fixtures:record` | nagrywa prawdziwe odpowiedzi portali jako fixture'y testów |

## Zmienne środowiskowe

Patrz `.env.example`. Najważniejsze: `DATABASE_URL`, `DATABASE_URL_MIGRATIONS`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`, `APP_BASE_URL`, opcjonalnie `OLX_PROXY_URL`, `WORKER_SOURCES`, `APP_SECRET`
(nagłówek `X-App-Secret` wymagany dla operacji zapisu), `SCRAPE_STEP_BUDGET_MS` (8000; na planie kredytowym
Netlify można 20000).
