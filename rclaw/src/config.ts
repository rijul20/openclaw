import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface TelegramConfig {
  botToken: string;
}

export interface WhatsAppConfig {
  authDir: string;
}

export interface SlackConfig {
  botToken: string;
  appToken: string;
}

export interface UserChannels {
  telegram?: TelegramConfig;
  whatsapp?: WhatsAppConfig;
  slack?: SlackConfig;
}

export interface UserConfig {
  workspace: string;
  model: string;
  channels: UserChannels;
}

export interface Config {
  users: Record<string, UserConfig>;
  qrPort: number;
}

export function loadConfig(configPath?: string): Config {
  const path = resolve(configPath ?? "config.json");
  const raw = readFileSync(path, "utf-8");
  const config: Config = JSON.parse(raw);

  for (const [_userId, user] of Object.entries(config.users)) {
    user.workspace = resolve(user.workspace);
    if (user.channels.whatsapp) {
      user.channels.whatsapp.authDir = resolve(user.channels.whatsapp.authDir);
    }
    if (!user.model) {
      user.model = "sonnet";
    }
  }

  return config;
}
