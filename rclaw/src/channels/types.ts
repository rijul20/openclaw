export type MessageHandler = (text: string, reply: (text: string) => Promise<void>) => void;
export type WhatsAppMessageHandler = (
  fromJid: string,
  text: string,
  reply: (text: string) => Promise<void>,
) => void;

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string): Promise<void>;
  sendToContact?(to: string, text: string): Promise<void>;
}
