import { env } from "../env";
import { createTelegramNotifier } from "./telegram";
import type { Notifier } from "./types";

export function defaultNotifiers(): Notifier[] {
  return [createTelegramNotifier({ token: env.telegramBotToken, chatId: env.telegramChatId })];
}
