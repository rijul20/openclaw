# WhatsApp Implementation Plan

## Current State (v0)

Our WhatsApp adapter (`src/channels/whatsapp.ts`, ~185 lines) handles basic text, images, documents, and voice notes. It uses Baileys directly but with manual property checks that miss many message types.

### Known Issues

1. **Files not always detected** — manual `msg.message?.imageMessage` checks miss view-once, ephemeral, edited, and forwarded message wrappers
2. **Contact replies sometimes lost** — text extraction only checks `conversation` and `extendedTextMessage`, missing other text-bearing types
3. **Noisy logs** — Baileys dumps "Closing session" entries with full encryption keys to stderr
4. **Bad MAC errors** — encryption session gets out of sync after restarts, causing "waiting for this message" on receiver end
5. **No support** for stickers, contacts, locations, polls, reactions, voice notes (ptt), or group messages
6. **No message quoting** — agent can't reply to a specific message
7. **No media sending** — agent can only send text, not images/docs/audio

---

## Suggested Improvements (prioritized)

### P0 — Fix What's Broken

#### 1. Use Baileys utility functions instead of manual property checks

**Problem:** We read `msg.message?.imageMessage` directly. This misses messages wrapped in `ephemeralMessage`, `viewOnceMessage`, `editedMessage`, or `documentWithCaptionMessage`.

**Fix:** Use `extractMessageContent()` and `getContentType()` from Baileys.

```typescript
import { extractMessageContent, getContentType } from "@whiskeysockets/baileys";

// BEFORE (fragile):
const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text;
const mediaType = msg.message?.imageMessage && "image";

// AFTER (handles all wrappers):
const content = extractMessageContent(msg.message);
const contentType = getContentType(content);
// contentType = 'conversation' | 'imageMessage' | 'videoMessage' | 'audioMessage' | etc.
```

This single change fixes file detection, view-once messages, edited messages, and forwarded messages.

#### 2. Fix media download reliability

**Problem:** `downloadMediaMessage(msg, "buffer", {})` sometimes fails silently.

**Fix:** Add the `reuploadRequest` handler and proper error recovery.

```typescript
const buffer = await downloadMediaMessage(
  msg,
  "buffer",
  {},
  {
    logger: console,
    reuploadRequest: async (updatedMsg) => updatedMsg, // handle 404 media
  },
);
```

#### 3. Fix encryption session sync (Bad MAC errors)

**Problem:** Restarts cause encryption key mismatches. Messages show "waiting for this message" on the receiver.

**Fix:**

- Add `msgRetryCounterCache` (NodeCache) to handle message retry
- Use `makeCacheableSignalKeyStore` (already doing this)
- On persistent Bad MAC errors, auto-clear the specific contact's session keys (not the entire auth)

```typescript
import NodeCache from "node-cache";
const msgRetryCounterCache = new NodeCache({ stdTTL: 600 }); // 10 min TTL

const sock = makeWASocket({
  auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
  msgRetryCounterCache,
  // ...
});
```

#### 4. Suppress noisy logs

**Problem:** Baileys dumps "Closing session: SessionEntry { ... }" to stderr with full encryption key buffers.

**Fix:** Filter stderr output in the orchestrator, and set baileys logger to `warn` level.

```typescript
// In orchestrator stderr handler:
stderr: (data: string) => {
  if (data.includes("Closing session") || data.includes("SessionEntry")) return;
  if (data.trim()) console.error(`[${userId}][stderr] ${data.trim().slice(0, 200)}`);
};

// In WhatsApp channel:
const logger = pino({ level: "warn" }); // not "silent" — we want errors
```

---

### P1 — Handle All Inbound Message Types

#### 5. Full message type router

Replace the current if/else chain with a proper switch on `getContentType()`.

```typescript
const content = extractMessageContent(msg.message);
const contentType = getContentType(content);

switch (contentType) {
  case "conversation":
  case "extendedTextMessage":
    text = content?.conversation || content?.extendedTextMessage?.text || "";
    break;
  case "imageMessage":
    // download + save + notify agent
    break;
  case "videoMessage":
    // download + save + notify agent
    break;
  case "audioMessage":
    // download + save + notify agent (note: ptt = voice note)
    break;
  case "documentMessage":
    // download + save with original filename
    break;
  case "stickerMessage":
    // download as webp + notify agent
    break;
  case "locationMessage":
    // extract lat/lng/name/address + notify agent as text
    break;
  case "contactMessage":
    // extract vcard + display name + notify agent
    break;
  case "pollCreationMessage":
    // extract poll name + options + notify agent
    break;
  case "reactionMessage":
    // extract emoji + referenced message key
    break;
}
```

#### 6. Voice note handling

Voice notes (`audioMessage` with `ptt: true`) are the most common non-text message on WhatsApp. Currently we save them as `.ogg` but the agent can't listen to audio.

**Options:**

- Save as `.ogg` and tell the agent it's a voice note (current behavior)
- Transcribe using Whisper/speech-to-text and pass transcript to agent (v1+)
- For now: just clearly label it `[Voice note received, X seconds, saved at <path>. Audio transcription not available yet.]`

#### 7. Location messages

Extract as text for the agent:

```typescript
case 'locationMessage':
  const loc = content?.locationMessage
  text = `[Location shared: ${loc?.name || 'Unknown'}, ${loc?.address || ''}, ` +
    `coordinates: ${loc?.degreesLatitude}, ${loc?.degreesLongitude}]`
  break
```

#### 8. Contact card messages

Extract vcard info:

```typescript
case 'contactMessage':
  const contact = content?.contactMessage
  text = `[Contact shared: ${contact?.displayName}, vCard: ${contact?.vcard}]`
  break
```

#### 9. Forwarded message detection

Check `forwardingScore` to know if a message was forwarded:

```typescript
const isForwarded = (msg.message as any)?.forwardingScore > 0;
if (isForwarded) {
  text = `[Forwarded] ${text}`;
}
```

#### 10. Quoted/replied message context

When someone replies to a specific message, include the quoted context:

```typescript
const contextInfo = content?.extendedTextMessage?.contextInfo;
if (contextInfo?.quotedMessage) {
  const quotedText = extractMessageContent(contextInfo.quotedMessage);
  const quotedContent =
    quotedText?.conversation || quotedText?.extendedTextMessage?.text || "[media]";
  text = `[Replying to: "${quotedContent.slice(0, 100)}"]\n${text}`;
}
```

---

### P2 — Outbound Message Types (Agent Can Send)

Currently the agent can only send text via the `/send` API. Extend the API to support media sending.

#### 11. Send images

```
POST /send { "channel": "whatsapp", "to": "+91...", "type": "image", "file": "/path/to/image.jpg", "caption": "Check this" }
```

Implementation:

```typescript
await sock.sendMessage(jid, {
  image: fs.readFileSync(filepath),
  caption,
  mimetype: "image/jpeg",
});
```

#### 12. Send documents

```
POST /send { "channel": "whatsapp", "to": "+91...", "type": "document", "file": "/path/to/report.pdf", "filename": "report.pdf" }
```

Implementation:

```typescript
await sock.sendMessage(jid, {
  document: fs.readFileSync(filepath),
  fileName: filename,
  mimetype: "application/pdf",
});
```

#### 13. Send voice notes

```
POST /send { "channel": "whatsapp", "to": "+91...", "type": "audio", "file": "/path/to/audio.ogg", "ptt": true }
```

Implementation:

```typescript
await sock.sendMessage(jid, {
  audio: fs.readFileSync(filepath),
  ptt: true, // voice note
  mimetype: "audio/ogg; codecs=opus",
});
```

#### 14. Send locations

```
POST /send { "channel": "whatsapp", "to": "+91...", "type": "location", "latitude": 28.6139, "longitude": 77.2090, "name": "Delhi" }
```

#### 15. Send contacts

```
POST /send { "channel": "whatsapp", "to": "+91...", "type": "contact", "name": "Priya", "phone": "+91..." }
```

#### 16. React to messages

```
POST /react { "channel": "whatsapp", "messageId": "...", "emoji": "👍" }
```

#### 17. Reply to specific messages (quoting)

```
POST /send { "channel": "whatsapp", "to": "+91...", "text": "reply text", "quotedMessageId": "..." }
```

Requires caching received messages by ID so we can pass the `quoted` parameter.

---

### P3 — Session Reliability

#### 18. Pairing code authentication (alternative to QR)

QR codes expire and require browser access. Pairing codes are more reliable for headless setups.

```typescript
if (!sock.authState.creds.registered) {
  const code = await sock.requestPairingCode(phoneNumber);
  console.log(`Enter this code in WhatsApp: ${code}`);
}
```

Add to config: `"whatsapp": { "authDir": "...", "pairingNumber": "+91..." }` — if set, use pairing code instead of QR.

#### 19. Message retry counter cache

Prevents infinite retry loops on failed decryption:

```typescript
import NodeCache from "node-cache";
const msgRetryCounterCache = new NodeCache({ stdTTL: 600 });
// Pass to makeWASocket options
```

#### 20. In-memory store for message history

Baileys has a built-in message store that caches messages for quoting and poll aggregation:

```typescript
import { makeInMemoryStore } from "@whiskeysockets/baileys";
const store = makeInMemoryStore({ logger });
store.bind(sock.ev);
// Now: store.messages[jid] has recent messages for quoting
```

#### 21. Graceful reconnection with backoff

Current: fixed 3s retry. Better: exponential backoff with max retries.

```typescript
let reconnectAttempts = 0;
const MAX_RECONNECT = 5;

// In connection.update handler:
if (connection === "close" && statusCode !== DisconnectReason.loggedOut) {
  reconnectAttempts++;
  if (reconnectAttempts <= MAX_RECONNECT) {
    const delay = Math.min(3000 * Math.pow(2, reconnectAttempts - 1), 60000);
    console.log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts}/${MAX_RECONNECT})`);
    setTimeout(() => this.start(), delay);
  } else {
    console.error("Max reconnect attempts reached");
  }
}
// Reset on successful connection:
if (connection === "open") reconnectAttempts = 0;
```

---

### P4 — Nice to Have (v2+)

#### 22. Voice note transcription

Receive voice note → save `.ogg` → run through Whisper API → pass transcript to agent.

#### 23. Image OCR / description

Receive image → run through Claude vision or OCR → pass description to agent.

#### 24. Group message support

Currently we only handle 1:1 messages. Group messages need:

- Detect group vs individual (`jid.endsWith('@g.us')`)
- Extract sender within group (`msg.key.participant`)
- Only respond when mentioned or triggered by keyword
- Group-specific CLAUDE.md with rules about when to chime in

#### 25. Read receipts

Send read receipts so the sender knows the bot read their message:

```typescript
await sock.readMessages([msg.key]);
```

#### 26. Presence management

Show online/offline status:

```typescript
await sock.sendPresenceUpdate("available"); // or 'unavailable'
```

#### 27. Status/story posting

Post to WhatsApp status:

```typescript
await sock.sendMessage("status@broadcast", { text: "Status update" });
```

#### 28. Message deletion

Delete a sent message:

```typescript
await sock.sendMessage(jid, { delete: messageKey });
```

#### 29. Message editing

Edit a sent message (WhatsApp now supports this):

```typescript
await sock.sendMessage(jid, {
  text: "edited text",
  edit: originalMessageKey,
});
```

---

## Critical Analysis — Additional Items

Found during review. All approved for implementation alongside P0-P3.

- **Merge #3 and #19** — same item (msgRetryCounterCache), implement once in P0
- **Move #20 (message store) to P0** — P2 #17 (quoting) depends on it
- **#30 — File size limit: 50MB** — skip download for files >50MB, notify agent with metadata only
- **#31 — Path validation on /send API** — restrict file paths to agent's workspace directory
- **#32 — Message deduplication** — track last N message IDs, skip duplicates
- **#33 — Outbound rate limiter** — 500ms spacing between WhatsApp sends
- **#34 — Group message handling** — reply "I don't do groups yet" to @g.us messages, then ignore
- **#35 — Stream large media** — buffer for <10MB, stream to disk for larger
- **#36 — Download failure notification** — tell agent "image download failed" instead of silently swallowing
- **#37 — Proper reuploadRequest handler** — call `sock.updateMediaMessage(msg)`, not a no-op

---

## Decisions Log

### P0 — All 4 items: ✅ TO IMPLEMENT

- #1 Use `extractMessageContent()` + `getContentType()` — approved, fixes all message detection bugs
- #2 Add `reuploadRequest` handler to `downloadMediaMessage` — approved, fixes silent media failures
- #3 Add `msgRetryCounterCache` (node-cache) — approved, fixes Bad MAC / "waiting for this message"
- #4 Logger to `"warn"` + filter "Closing session" in stderr — approved, cleans up logs

### P1 — All 6 items: ✅ TO IMPLEMENT

- #5 Full message type router (switch on `getContentType()`) — approved
- #6 Voice notes — save `.ogg`, label with duration, note no transcription yet — approved
- #7 Locations — extract as text with lat/lng/name/address — approved
- #8 Contact cards — extract display name + vcard — approved
- #9 Forwarded detection — prefix `[Forwarded]` — approved
- #10 Quoted/reply context — include quoted message text — approved

### P2 — All 7 items: ✅ TO IMPLEMENT

- #11 Send images (file path + caption) — approved
- #12 Send documents/PDFs (filename + mime detection) — approved
- #13 Send voice notes (`.ogg`, `ptt: true`) — approved
- #14 Send locations (lat/lng/name) — approved
- #15 Send contacts (name + phone as vcard) — approved
- #16 React to messages (emoji on message ID) — approved
- #17 Reply/quote specific messages (requires message cache) — approved

### P3 — All 4 items: ✅ TO IMPLEMENT

- #18 Pairing code auth (alternative to QR, headless-friendly) — approved
- #19 Message retry counter cache (overlaps with P0 #3) — approved
- #20 In-memory message store (needed for #17 quoting) — approved
- #21 Exponential backoff reconnection (replace fixed 3s retry) — approved

### P4 — ⏭️ SKIPPED (defer to v2+)

- #22-29 — Voice transcription, image OCR, groups, read receipts, presence, status, delete, edit

---

## Implementation Order

| Phase  | Items                                         | Effort       | Impact                              | Status         |
| ------ | --------------------------------------------- | ------------ | ----------------------------------- | -------------- |
| **P0** | #1-4 (utilities, download fix, Bad MAC, logs) | 1 session    | Fixes all current bugs              | ✅ Approved    |
| **P1** | #5-10 (all inbound types)                     | 1 session    | Agent can see everything sent to it | Review pending |
| **P2** | #11-17 (outbound media + reactions)           | 1-2 sessions | Agent can send rich messages        | Review pending |
| **P3** | #18-21 (session reliability)                  | 1 session    | Stable long-running deployment      | Review pending |
| **P4** | #22-29 (voice transcription, groups, etc.)    | Ongoing      | Polish and advanced features        | Review pending |

## Reference Repos

- **WhiskeySockets/Baileys** — https://github.com/WhiskeySockets/Baileys (core library, example.ts)
- **EvolutionAPI** — https://github.com/EvolutionAPI/evolution-api (production wrapper, media pipeline)
- **bot-wa-baileys** — https://github.com/andresayac/bot-wa-baileys (clean abstraction)
- **baileys-api** — https://github.com/nizarfadlan/baileys-api (REST API wrapper)
- **Baileys wiki** — https://baileys.wiki (new official guide)

## Dependencies to Add

- `node-cache` — message retry counter cache (prevents infinite decryption retries)
- `@hapi/boom` — proper error type for disconnect reason checking
- `file-type` (optional) — detect media MIME type from buffer
- `sharp` (optional) — image thumbnail generation
- `fluent-ffmpeg` (optional) — audio conversion for voice notes
