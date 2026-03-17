export type MessageHandler = (text: string, reply: (text: string) => Promise<void>) => void;
export type WhatsAppMessageHandler = (
  fromJid: string,
  text: string,
  reply: (text: string) => Promise<void>,
) => void;

export interface ChannelAdapter {
  /** Which channel this is (e.g. "telegram", "whatsapp", "slack") */
  channelName: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendToContact?(to: string, text: string): Promise<void>;
  /** Send a filler/progress message to the last active chat */
  sendFiller?(text: string): Promise<void>;
}
