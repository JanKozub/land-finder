import { Download, Map as MapIcon, Settings, Table2 } from "lucide-react";
import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { cn } from "./ui/cn";

const links = [
  { to: "/", label: "Mapa", icon: MapIcon },
  { to: "/oferty", label: "Oferty", icon: Table2 },
  { to: "/pobieranie", label: "Pobieranie", icon: Download },
  { to: "/ustawienia", label: "Ustawienia", icon: Settings },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-slate-200 bg-white px-4">
        <span className="text-sm font-bold tracking-tight text-slate-900">Działki i domy</span>
        <nav className="flex items-center gap-1">
          {links.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              className={({ isActive }) =>
                cn(
                  "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium",
                  isActive ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100",
                )
              }
            >
              <Icon className="h-4 w-4" aria-hidden />
              <span className="hidden sm:inline">{label}</span>
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}
