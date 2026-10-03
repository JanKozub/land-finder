export interface Notifier {
  id: string;
  isConfigured(): boolean;
  /** Sends one message formatted as Telegram-style HTML (<b>, <a href>). */
  send(html: string): Promise<void>;
}
