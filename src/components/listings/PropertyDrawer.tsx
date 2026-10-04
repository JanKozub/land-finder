import { Ban, ExternalLink, Eye, EyeOff, Heart, RotateCcw, Scissors, X } from "lucide-react";
import { useEffect, useState } from "react";
import type { Source } from "@shared/constants";
import type { ListingDto } from "@shared/schemas";
import { useDetachListing, useFavoriteProperty, useHideProperty, useIgnoreListing, useIgnoreProperty, useMergeProperty, useProperty, useSaveNote } from "@/api/hooks";
import { SOURCE_LABEL } from "@/i18n/pl";
import { formatArea, formatDateTime, formatPln, formatPricePerM2 } from "@/lib/format";
import { Badge, Button, ErrorText, Input, Spinner } from "../ui";
import { cn } from "../ui/cn";
import { KindBadge } from "./PropertyCard";

function ListingRow({
  listing,
  canDetach,
  onDetach,
  detaching,
  onToggleIgnore,
  ignoring,
}: {
  listing: ListingDto;
  canDetach: boolean;
  onDetach: () => void;
  detaching: boolean;
  onToggleIgnore: () => void;
  ignoring: boolean;
}) {
  return (
    <li className={cn("rounded-md border border-slate-200 p-2.5 text-sm", listing.ignored && "bg-slate-50 opacity-70")}>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge className="bg-slate-100 text-slate-700">{SOURCE_LABEL[listing.source as Source] ?? listing.source}</Badge>
        {!listing.isActive && <Badge className="bg-rose-100 text-rose-700">nieaktywne</Badge>}
        {listing.ignored && <Badge className="bg-slate-200 text-slate-600">ignorowane</Badge>}
        {listing.pinned && <Badge className="bg-violet-100 text-violet-700" title="Przypisanie ustawione ręcznie">ręcznie</Badge>}
        <span className="ml-auto text-xs text-slate-500">dodano {formatDateTime(listing.sourceCreatedAt ?? listing.firstSeenAt)}</span>
      </div>
      <p className="mt-1 font-medium leading-snug">{listing.title}</p>
      <p className="text-slate-700">
        <b>{formatPln(listing.price)}</b>
        {listing.priceNegotiable && <span className="text-xs text-slate-500"> (do negocjacji)</span>}
        {listing.pricePerM2 !== null && <span className="text-slate-500"> · {formatPricePerM2(listing.pricePerM2)}</span>}
        <span className="text-slate-500"> · {formatArea(listing.areaM2, listing.kind)}</span>
        {listing.plotAreaM2 !== null && <span className="text-slate-500"> · działka {formatArea(listing.plotAreaM2, "plot")}</span>}
      </p>
      {listing.priceHistory.length > 0 && (
        <p className="text-xs text-slate-500">
          Historia cen: {listing.priceHistory.map((h) => `${formatPln(h.price)} (${formatDateTime(h.observedAt)})`).join(" → ")}
        </p>
      )}
      <p className="text-xs text-slate-500">
        {[listing.city, listing.district].filter(Boolean).join(", ")}
        {listing.advertiserName && ` · ${listing.advertiserName}`}
        {listing.isPrivate === true && " · prywatny"}
        {listing.isPrivate === false && " · agencja"}
        {listing.plotType && ` · ${listing.plotType.replace(/-/g, " ")}`}
      </p>
      {listing.descriptionExcerpt && <p className="mt-1 line-clamp-3 text-xs text-slate-600">{listing.descriptionExcerpt}</p>}
      <div className="mt-2 flex items-center gap-1.5">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-700"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Otwórz na {SOURCE_LABEL[listing.source as Source] ?? listing.source}
        </a>
        <Button size="sm" variant="ghost" onClick={onToggleIgnore} loading={ignoring} title={listing.ignored ? "Przywróć ogłoszenie" : "Ignoruj to ogłoszenie"}>
          {listing.ignored ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
          {listing.ignored ? "Przywróć" : "Ignoruj"}
        </Button>
        {canDetach && (
          <Button size="sm" variant="ghost" onClick={onDetach} loading={detaching} title="Rozdziel — to inne ogłoszenie niż pozostałe">
            <Scissors className="h-3.5 w-3.5" /> To nie ta sama oferta
          </Button>
        )}
      </div>
    </li>
  );
}

export function PropertyDrawer({ id, onClose, onNavigate }: { id: number; onClose: () => void; onNavigate: (id: number) => void }) {
  const { data, isLoading, error } = useProperty(id);
  const hide = useHideProperty();
  const saveNote = useSaveNote();
  const detach = useDetachListing();
  const ignore = useIgnoreListing();
  const ignoreAll = useIgnoreProperty();
  const favorite = useFavoriteProperty();
  const merge = useMergeProperty();
  const [note, setNote] = useState("");
  const [mergeId, setMergeId] = useState("");
  useEffect(() => setNote(data?.note ?? ""), [data?.note, id]);

  return (
    <aside className="absolute inset-y-0 right-0 z-[1000] flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-xl">
      <header className="flex items-center gap-2 border-b border-slate-200 px-4 py-2">
        <h2 className="text-sm font-semibold">Nieruchomość #{id}</h2>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={onClose} aria-label="Zamknij">
          <X className="h-4 w-4" />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
        {isLoading && <Spinner />}
        <ErrorText error={error} />
        {data && (
          <>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <KindBadge kind={data.kind} />
                {data.favorite && <Badge className="bg-pink-100 text-pink-700">♥ ulubione</Badge>}
                {data.hidden && <Badge className="bg-slate-200 text-slate-600">ukryte</Badge>}
                {data.ignored && <Badge className="bg-slate-200 text-slate-600">ignorowane</Badge>}
                {!data.isActive && <Badge className="bg-rose-100 text-rose-700">wygasłe</Badge>}
                <Badge className="bg-slate-100 text-slate-600">{data.listingCount} ogł.</Badge>
              </div>
              <h3 className="text-base font-semibold leading-snug">{data.title}</h3>
              <p>
                <span className="text-lg font-bold">{formatPln(data.price)}</span>
                {data.pricePerM2 !== null && <span className="text-slate-500"> · {formatPricePerM2(data.pricePerM2)}</span>}
              </p>
              <p className="text-sm text-slate-700">
                {formatArea(data.areaM2, data.kind)}
                {data.kind === "house" && data.plotAreaM2 !== null && ` · działka ${formatArea(data.plotAreaM2, "plot")}`}
              </p>
              <p className="text-xs text-slate-500">
                {[data.city, data.district].filter(Boolean).join(", ")}
                {data.lat !== null && ` · ${data.lat.toFixed(5)}, ${data.lon!.toFixed(5)}`}
                {data.locationPrecision === "approx" && " · lokalizacja przybliżona"}
                {data.locationPrecision === "unknown" && " · brak współrzędnych"}
              </p>
              <div className="flex flex-wrap gap-1.5 pt-1">
                <Button variant="primary" size="sm" onClick={() => window.open(data.url, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="h-3.5 w-3.5" /> Otwórz ofertę
                </Button>
                <Button size="sm" onClick={() => favorite.mutate({ id, favorite: !data.favorite })} loading={favorite.isPending} aria-pressed={data.favorite}>
                  <Heart className={cn("h-3.5 w-3.5", data.favorite ? "fill-pink-500 text-pink-600" : "")} />
                  {data.favorite ? "Ulubione" : "Do ulubionych"}
                </Button>
                <Button size="sm" onClick={() => hide.mutate({ id, hidden: !data.hidden })} loading={hide.isPending}>
                  {data.hidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                  {data.hidden ? "Przywróć" : "Ukryj"}
                </Button>
                <Button
                  size="sm"
                  onClick={() => ignoreAll.mutate({ id, ignored: !data.ignored })}
                  loading={ignoreAll.isPending}
                  title={data.ignored ? "Przywróć wszystkie ogłoszenia" : "Ignoruj wszystkie ogłoszenia tej nieruchomości"}
                >
                  {data.ignored ? <RotateCcw className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5" />}
                  {data.ignored ? "Przywróć ogłoszenia" : "Ignoruj"}
                </Button>
                {data.lat !== null && (
                  <a
                    className="inline-flex h-8 items-center rounded-md border border-slate-300 px-2.5 text-xs font-medium hover:bg-slate-100"
                    href={`https://www.google.com/maps?q=${data.lat},${data.lon}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Google Maps
                  </a>
                )}
              </div>
            </div>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Notatka</h4>
              <textarea
                className="w-full rounded-md border border-slate-300 p-2 text-sm focus:border-slate-500 focus:outline-none"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Twoje uwagi…"
              />
              <div className="mt-1 flex justify-end">
                <Button size="sm" onClick={() => saveNote.mutate({ id, note: note.trim() || null })} loading={saveNote.isPending} disabled={(data.note ?? "") === note.trim()}>
                  Zapisz notatkę
                </Button>
              </div>
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Ogłoszenia ({data.listings.length})</h4>
              <ul className="space-y-2">
                {data.listings.map((l) => (
                  <ListingRow
                    key={l.id}
                    listing={l}
                    canDetach={data.listings.length > 1}
                    detaching={detach.isPending && detach.variables === l.id}
                    ignoring={ignore.isPending && ignore.variables?.id === l.id}
                    onToggleIgnore={() => ignore.mutate({ id: l.id, ignored: !l.ignored })}
                    onDetach={() =>
                      detach.mutate(l.id, {
                        onSuccess: (res) => {
                          if (res.propertyId !== id) onNavigate(res.propertyId);
                        },
                      })
                    }
                  />
                ))}
              </ul>
              <ErrorText error={detach.error ?? ignore.error ?? ignoreAll.error ?? favorite.error} />
            </section>

            <section>
              <h4 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Scal z inną nieruchomością</h4>
              <div className="flex gap-2">
                <Input value={mergeId} onChange={(e) => setMergeId(e.target.value)} placeholder="ID nieruchomości" inputMode="numeric" />
                <Button
                  onClick={() => merge.mutate({ id, sourcePropertyId: Number(mergeId) }, { onSuccess: () => setMergeId("") })}
                  disabled={!/^\d+$/.test(mergeId) || Number(mergeId) === id}
                  loading={merge.isPending}
                >
                  Scal
                </Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Ogłoszenia podanej nieruchomości zostaną dołączone do tej (ID widać w nagłówku).</p>
              <ErrorText error={merge.error} />
            </section>
          </>
        )}
      </div>
    </aside>
  );
}
