import type { Notifier } from "./types";

export interface TelegramOptions {
  token: string;
  chatId: string;
  fetchImpl?: typeof fetch;
}

export function createTelegramNotifier(opts: TelegramOptions): Notifier {
  const fetchImpl = opts.fetchImpl ?? fetch;
  return {
    id: "telegram",
    isConfigured: () => Boolean(opts.token && opts.chatId),
    async send(html) {
      const res = await fetchImpl(`https://api.telegram.org/bot${opts.token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: opts.chatId,
          text: html,
          parse_mode: "HTML",
          disable_web_page_preview: true,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; description?: string };
      if (!res.ok || body.ok === false) throw new Error(`Telegram: ${body.description ?? `HTTP ${res.status}`}`);
    },
  };
}
