# Personas

A persona is a base template for an agent's personality, behaviour, and capabilities. Users personalize a persona to create their agent.

## How it works

```
personas/assistant/CLAUDE.md   ← Base template (directives, values, capabilities)
     ↓
  Personality Designer          ← User answers 13 questions
     ↓
~/.rclaw/agents/alice/CLAUDE.md ← Personalized instance (Ayesha = assistant + identity)
```

## Available personas

| Persona           | Description                                                                                            | Use case                               |
| ----------------- | ------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| **assistant**     | Personal AI assistant. Warm, capable, proactive. Manages tasks, contacts, calendar, and conversations. | General-purpose personal assistant     |
| coach _(planned)_ | Reflective coach. Asks questions, nudges growth, tracks goals.                                         | Personal development, accountability   |
| ops _(planned)_   | Operations manager. Task-focused, structured, minimal personality.                                     | Business operations, team coordination |

## Persona structure

```
personas/<name>/
  CLAUDE.md         # Base template with {{PLACEHOLDER}} sections
  fillers/          # Default filler messages by language
    en.txt
    hi-en.txt
    fr.txt
  tests/            # Behaviour tests specific to this persona
    b2-response-endings.test.ts
    b3-tone-adaptation.test.ts
    ...
```

## Creating a new persona

1. Create `personas/<name>/CLAUDE.md` with the base template
2. Use `{{PLACEHOLDER}}` for sections the user will personalize
3. Include all behavioural directives (B1-B13) relevant to this persona
4. Write behaviour tests in `personas/<name>/tests/`
5. Update the personality designer to offer this persona as a choice

## Personalizing a persona

```bash
npm run design -- ~/.rclaw/agents/myagent
```

The personality designer will:

1. Ask which persona to use (assistant, coach, etc.)
2. Ask personalization questions (name, language, tone, etc.)
3. Generate the final CLAUDE.md = persona template + personal identity
4. Generate fillers.txt matching the chosen language/personality

## Testing

Behaviour tests validate the persona's directives, not any individual user's customization:

```bash
# Test all personas
BEHAVIOUR=1 npm run test:behaviour

# Test a specific persona
BEHAVIOUR=1 npx vitest run tests/behaviour/
```

Tests use the persona's base template to ensure directives work regardless of personalization.
