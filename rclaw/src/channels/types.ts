export type MessageHandler = (text: string, reply: (text: string) => Promise<void>) => void;

export interface ChannelAdapter {
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(text: string): Promise<void>;
}
