import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { ListingsPage } from "./pages/ListingsPage";
import { MapPage } from "./pages/MapPage";
import { ScrapePage } from "./pages/ScrapePage";
import { SettingsPage } from "./pages/SettingsPage";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<MapPage />} />
        <Route path="/oferty" element={<ListingsPage />} />
        <Route path="/pobieranie" element={<ScrapePage />} />
        <Route path="/ustawienia" element={<SettingsPage />} />
        <Route path="*" element={<MapPage />} />
      </Routes>
    </Layout>
  );
}
