# Agent Capabilities Catalog

What tools/integrations exist that expand what our agents can DO.
All of these have MCP servers, CLIs, or REST APIs that a Claude Code agent can call.

---

## Already Built Into Claude Code (free, no setup)

These work out of the box in every agent session:

- **Web search** (WebSearch tool)
- **Web fetch** (WebFetch tool — reads any URL)
- **File read/write/edit** (Read, Write, Edit, Glob, Grep)
- **Bash** (run any command)
- **Agent subprocesses** (Agent tool)

---

## Tier A — High-Value, Easy to Add (MCP server or simple CLI)

### Communication & Productivity

| Capability                                                  | Best Tool                                                                     | How It Works                                  | Setup                       |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------- | --------------------------- |
| **Google Workspace** (Gmail, Calendar, Docs, Sheets, Drive) | [google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp) | MCP server, all-in-one, 12 Google services    | OAuth once, then MCP config |
| **Microsoft 365** (Outlook, Teams, OneDrive, Excel)         | [ms-365-mcp-server](https://github.com/Softeria/ms-365-mcp-server)            | MCP server via Graph API                      | Azure app registration      |
| **Email** (any provider, IMAP/SMTP)                         | [mcp-email-server](https://github.com/ai-zerolab/mcp-email-server)            | MCP server, search/read/send/manage           | IMAP/SMTP creds             |
| **Notion**                                                  | [notion-mcp-server](https://github.com/makenotion/notion-mcp-server)          | Official MCP: pages, databases, search        | Notion API token            |
| **Calendar scheduling**                                     | [Cal.com](https://github.com/calcom/cal.com)                                  | Open-source Calendly alternative + MCP        | Self-host or cloud          |
| **GitHub**                                                  | [github-mcp-server](https://github.com/github/github-mcp-server)              | Official: repos, PRs, issues, actions, search | `gh` CLI already works too  |

### Phone & SMS

| Capability                  | Best Tool                                                                           | How It Works                                                | Setup                |
| --------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| **Phone control** (Android) | [PhonePi MCP](https://github.com/priyankark/phonepi-mcp)                            | 23+ actions: SMS, calls, contacts, clipboard, notifications | Android app + MCP    |
| **SMS/voice calls**         | [Twilio MCP](https://www.twilio.com/en-us/blog/introducing-twilio-alpha-mcp-server) | 1,700+ API endpoints: SMS, voice, WhatsApp                  | Twilio account       |
| **Mobile automation**       | [Mobile MCP](https://github.com/mobile-next/mobile-mcp)                             | iOS + Android real device control                           | USB connected device |

### Browser

| Capability             | Best Tool                                                                           | How It Works                                                | Setup                |
| ---------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------- | -------------------- |
| **Browser automation** | [Playwright MCP](https://www.npmjs.com/package/@anthropic-ai/mcp-server-playwright) | Microsoft-backed, accessibility snapshots, no vision needed | `npm install`        |
| **AI browser**         | [Stagehand](https://github.com/browserbase/stagehand)                               | Natural language + code hybrid browser control              | TypeScript SDK       |
| **Web scraping**       | [Firecrawl MCP](https://github.com/firecrawl/firecrawl-mcp-server)                  | Crawl sites, structured extraction, LLM-ready markdown      | API key or self-host |

### Search

| Capability             | Best Tool                                                   | How It Works                                | Setup               |
| ---------------------- | ----------------------------------------------------------- | ------------------------------------------- | ------------------- |
| **Private web search** | [SearXNG MCP](https://github.com/ihor-sokoliuk/mcp-searxng) | Self-hosted metasearch, no tracking         | Docker instance     |
| **AI search**          | [Tavily](https://github.com/tavily-ai/tavily-python)        | Purpose-built for agents, relevance scoring | API key (free tier) |

---

## Tier B — Medium Value, Medium Setup

### Finance & Payments

| Capability      | Best Tool                                                              | How It Works                                 | Setup          |
| --------------- | ---------------------------------------------------------------------- | -------------------------------------------- | -------------- |
| **Payments**    | [Stripe MCP](https://docs.stripe.com/mcp)                              | Official: invoices, subscriptions, customers | Stripe account |
| **PayPal**      | PayPal Agent Toolkit                                                   | Payments, invoices, disputes                 | PayPal account |
| **Market data** | [Financial Datasets MCP](https://docs.financialdatasets.ai/mcp-server) | Stock prices, fundamentals                   | API key        |

### CRM & Sales

| Capability     | Best Tool                                                        | How It Works                         | Setup     |
| -------------- | ---------------------------------------------------------------- | ------------------------------------ | --------- |
| **HubSpot**    | [HubSpot MCP](https://developers.hubspot.com/mcp)                | Official: contacts, deals, companies | OAuth     |
| **Salesforce** | Salesforce remote MCP                                            | 50 tools across CRM                  | OAuth     |
| **Pipedrive**  | [mcp-pipedrive](https://github.com/iamsamuelfraga/mcp-pipedrive) | Deals, persons, organizations        | API token |

### Project Management

| Capability  | Best Tool                                                            | How It Works                          | Setup          |
| ----------- | -------------------------------------------------------------------- | ------------------------------------- | -------------- |
| **Linear**  | [Linear MCP](https://mcp.linear.app/sse)                             | Official remote MCP: issues, projects | Linear API key |
| **Jira**    | Atlassian remote MCP                                                 | Issues, sprints, Confluence           | OAuth          |
| **Todoist** | [todoist-mcp-server](https://github.com/abhiz123/todoist-mcp-server) | Task management                       | API token      |

### Documents & OCR

| Capability                 | Best Tool                                                                                   | How It Works                               | Setup       |
| -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------ | ----------- |
| **PDF/Word/Excel parsing** | [AWS Document Loader MCP](https://awslabs.github.io/mcp/servers/document-loader-mcp-server) | Parse PDF, Word, Excel, PowerPoint, images | CLI install |
| **OCR**                    | [ocr-mcp](https://github.com/sandraschi/ocr-mcp)                                            | DeepSeek-OCR, Florence-2, PP-OCRv5         | MCP server  |

### Voice & Audio

| Capability         | Best Tool                                                      | How It Works                                | Setup               |
| ------------------ | -------------------------------------------------------------- | ------------------------------------------- | ------------------- |
| **Text-to-speech** | [ElevenLabs MCP](https://github.com/elevenlabs/elevenlabs-mcp) | Official: TTS, voice cloning, transcription | API key (free tier) |
| **Speech-to-text** | [Whisper](https://github.com/openai/whisper)                   | OpenAI, 90+ languages, runs locally         | `pip install`       |
| **Offline STT**    | [Vosk](https://github.com/alphacep/vosk-api)                   | Lightweight, 20+ languages, no API needed   | Download model      |

### Image & Video

| Capability           | Best Tool                                                               | How It Works            | Setup   |
| -------------------- | ----------------------------------------------------------------------- | ----------------------- | ------- |
| **Image generation** | [DALL-E MCP](https://github.com/spartanz51/imagegen-mcp)                | OpenAI image generation | API key |
| **Stable Diffusion** | [Stability AI MCP](https://github.com/tadasant/mcp-server-stability-ai) | Generate, edit, upscale | API key |
| **Screenshots**      | ScreenshotOne MCP                                                       | Capture any website     | API key |

---

## Tier C — Specialized / Future

### Social Media

| Capability                 | Best Tool                                         | How It Works                                  | Setup     |
| -------------------------- | ------------------------------------------------- | --------------------------------------------- | --------- |
| **Multi-platform posting** | [Postiz](https://github.com/gitroomhq/postiz-app) | Open-source: X, LinkedIn, Instagram, Facebook | Self-host |
| **Social monitoring**      | [Xpoz](https://www.xpoz.ai/)                      | Search X, Instagram, TikTok, Reddit           | API key   |

### Smart Home

| Capability         | Best Tool                                                        | How It Works                              | Setup       |
| ------------------ | ---------------------------------------------------------------- | ----------------------------------------- | ----------- |
| **Home Assistant** | [HA MCP](https://www.home-assistant.io/integrations/mcp_server/) | Official: lights, climate, media, sensors | HA instance |

### Travel

| Capability              | Best Tool                                                                | How It Works                             | Setup      |
| ----------------------- | ------------------------------------------------------------------------ | ---------------------------------------- | ---------- |
| **Flight/hotel search** | [MCP Travel Assistant](https://github.com/skarlekar/mcp_travelassistant) | Flights, hotels, events, weather, budget | MCP server |

### Database

| Capability           | Best Tool                                  | How It Works                        | Setup |
| -------------------- | ------------------------------------------ | ----------------------------------- | ----- |
| **Any SQL database** | [DBHub](https://github.com/bytebase/dbhub) | Postgres, MySQL, SQLite, SQL Server | CLI   |

---

## Meta-Platforms (connect to 100s of services at once)

| Platform                                               | What It Does                                                        | Integrations |
| ------------------------------------------------------ | ------------------------------------------------------------------- | ------------ |
| [**Composio**](https://github.com/ComposioHQ/composio) | Managed auth + MCP tools for 500+ apps                              | 500+         |
| [**n8n**](https://github.com/n8n-io/n8n)               | Open-source workflow automation, creates MCP servers from workflows | 1000+        |
| [**Pipedream MCP**](https://mcp.pipedream.com/)        | Connect any API as MCP tool                                         | 2,400+       |

These are the "cheat codes" — instead of adding one integration at a time, these platforms give you hundreds. **Composio or Pipedream could give Ayesha access to Google Workspace, Slack, Notion, HubSpot, Stripe, and hundreds more with a single MCP config.**

---

## Recommended First Capabilities (for Ayesha as EA)

An executive assistant needs:

1. **Google Workspace** — read/send email, check/create calendar events, read/edit docs (google_workspace_mcp)
2. **Browser** — fill forms, check websites, take screenshots (Playwright MCP)
3. **Phone SMS** — send/receive SMS as fallback to WhatsApp (Twilio MCP or PhonePi)
4. **Web scraping** — research companies, read articles (Firecrawl or Crawl4AI)
5. **Document parsing** — read PDFs, invoices, contracts (AWS Document Loader)
6. **Payments** — send invoices, check payment status (Stripe MCP)

OR: just add **Composio/Pipedream** and get all of the above + 500 more.
