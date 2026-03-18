# WhatsApp Group Bot — Implementation Plan

## Concept

A **separate bot instance** (new WhatsApp number, new agent workspace, clean context) that lives in a group chat. Not the user's personal bot — a fresh bot with zero personal context that can't leak anything.

Think of it as spawning a new character into a group chat. Fun, useful, safe.

## Key Decisions

1. **Trigger:** Bot's name mentioned in the message (e.g. "Ayesha what do you think?" or "@Ayesha check this")
2. **Separate bot:** New WhatsApp number, new agent entry in config.json, own workspace — completely isolated from any user's personal bot
3. **No personal context:** The group bot has NO access to any user's files, memory, contacts, or conversation history

## Architecture

```
Group WhatsApp Chat
  → Message arrives (from any participant)
    → Is it @g.us JID? Yes
      → Does it mention the bot's name?
        → Yes → Route to group agent session
        → No → Ignore
      → Group agent responds in the group
```

### Config Example

```json
{
  "users": {
    "alice": { ... },
    "veena": { ... },
    "group-bot": {
      "workspace": "/Users/rijul/.rclaw/agents/group-bot",
      "model": "sonnet",
      "channels": {
        "whatsapp": {
          "authDir": "/Users/rijul/.rclaw/agents/group-bot/whatsapp-auth",
          "ownerNumber": "",
          "groupMode": true,
          "botName": "Ayesha",
          "allowedGroups": ["group-jid@g.us"]
        }
      }
    }
  }
}
```

### Workspace

```
~/.rclaw/agents/group-bot/
  CLAUDE.md              # Group-appropriate personality (no personal context)
  memory/                # Group-shared memory (things the bot learns from the group)
  files/                 # Files shared in the group
```

### CLAUDE.md (Group Bot)

Different from the personal bot — aware it's in a group, knows multiple people, no personal assistant behavior.

```markdown
# Group Bot — Ayesha

You are Ayesha, a friendly bot in a WhatsApp group chat. Multiple people talk to you.

## Rules

- You only respond when someone mentions your name ("Ayesha")
- You can see all messages but only chime in when called
- You have NO personal information about anyone — you are not anyone's EA
- Keep responses short — this is a group chat, don't wall-of-text
- Be fun, helpful, and opinionated
- You can remember group context in memory/ files
- Never share one person's DM-style context with the group
- Always use "Aap"

## What You Know

- Only what's been said in this group chat
- Only what's in your workspace files
- Web search results
- Nothing else — you have no personal data about anyone
```

## Implementation Details

### 1. Group Message Detection

```typescript
const isGroup = jid.endsWith("@g.us");
```

### 2. Trigger Detection

```typescript
const botName = config.botName.toLowerCase(); // "ayesha"
const msgText = text.toLowerCase();

const isTriggered =
  msgText.includes(botName) ||
  msgText.includes(`@${botName}`) ||
  // Also check Baileys mention list
  contextInfo?.mentionedJid?.includes(sock.user?.id);
```

### 3. Sender Identification

In groups, include who said what so the bot knows:

```typescript
const senderName = msg.pushName || msg.key.participant?.split("@")[0] || "Someone";
const prompt = `[${senderName}]: ${text}`;
```

### 4. Context Model

**One session per group** (not per sender). The bot sees the conversation as a group thread.

Pros:

- Bot understands the full group conversation flow
- Can reference what different people said
- Natural group dynamic

Cons:

- Context window fills faster with multiple people
- Can't have private context per person (by design — that's the safety feature)

### 5. Rate Limiting (Important for Groups)

Groups are chatty. Without limits:

- 10 people mention the bot in 5 minutes = 10 agent calls
- Each call = ~12s (v0) or ~2s (v1) + API cost

Mitigations:

- **Cooldown per group:** Min 5 seconds between responses
- **Batch messages:** If 3 mentions arrive within 10 seconds, batch them into one prompt
- **Max responses per hour:** Cap at 30 per group per hour
- **Ignore rapid-fire:** If >5 mentions in 1 minute, respond once with "One at a time please 😄"

### 6. Multi-person Context in Prompt

The bot needs to know who's talking. Format messages with sender names:

```
[Rijul]: Ayesha what's the weather in Delhi?
[Priya]: Also check Bangalore
[Rahul]: And Mumbai while you're at it
```

Agent sees this as a multi-person thread and can address each person.

### 7. Group-Specific Features

Things that make sense in groups but not 1:1:

- **Polls:** "Ayesha create a poll: lunch options — pizza, sushi, biryani"
- **Summaries:** "Ayesha summarize what we discussed today"
- **Decisions:** "Ayesha what did we decide about the launch date?"
- **Reminders:** "Ayesha remind everyone about the meeting at 3"
- **Fun:** "Ayesha roast Rahul for being late again"

### 8. Allowed Groups Whitelist

Don't let random people add the bot to any group. Config includes `allowedGroups` — if the bot is added to an unknown group, it responds once with "I'm not authorized for this group" and stays silent.

```typescript
if (!config.allowedGroups.includes(groupJid)) {
  await sock.sendMessage(groupJid, {
    text: "I'm not set up for this group. Ask my admin to add it.",
  });
  return;
}
```

## Security Considerations

1. **Zero personal context** — group bot workspace is completely separate
2. **No cross-agent access** — can't read personal bot's files/memory
3. **Prompt injection from group members** — same guardrails as contact sessions, but lighter (group members are presumably semi-trusted)
4. **Bot can't DM** — group bot only responds in the group, never initiates 1:1 messages
5. **No file access outside workspace** — `bypassPermissions` but cwd is scoped

## What Changes in the Codebase

### Config

- Add `groupMode`, `botName`, `allowedGroups` to WhatsApp config type

### WhatsApp Channel

- If `groupMode: true`, flip behavior:
  - Accept `@g.us` messages (currently would be filtered)
  - Apply trigger detection (name mention)
  - Prefix messages with sender name
  - Apply group rate limiting

### Orchestrator

- No changes needed — group bot is just another agent entry with its own workspace
- No owner/contact routing — all messages go to one session

### This is the beauty of the architecture

Adding a group bot is literally:

1. New config entry
2. New WhatsApp number
3. New CLAUDE.md
4. A `groupMode` flag in the WhatsApp adapter

No new infrastructure. Same orchestrator, same session management, same channels.

## Future Ideas (not for now)

- **Per-group personality:** Different CLAUDE.md per group (work group = professional, friends group = casual)
- **Group memory:** Bot remembers group decisions, action items, running jokes
- **Thread support:** Bot creates WhatsApp threads for deep conversations
- **Admin commands:** Group admins can `/mute`, `/reset`, `/configure` the bot
- **Cross-group isolation:** Same bot number in multiple groups, each with separate session
