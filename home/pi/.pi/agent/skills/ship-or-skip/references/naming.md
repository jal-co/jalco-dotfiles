# Naming & domain availability

Goal: a name that's memorable, sayable, spellable, legally safe-ish, and **actually available** as a domain/handle.

## Process

1. **Anchor on the wedge.** Name the product for the specific job or user, not the whole category. The sharper the positioning, the easier the name.
2. **Generate breadth, then cut.** Produce 8–15 candidates across styles:
   - *Descriptive* (says what it does): `ShowNotesAI`
   - *Evocative / metaphor*: `Quill`, `Beacon`
   - *Invented / portmanteau*: `Notably`, `Castly`
   - *Compound*: `PodScribe`, `ShipOrSkip`
   - *Playful / short verbs*: `Vet`, `Forge`
3. **Filter** for: easy to say out loud, easy to spell after hearing it, no awkward acronym, no obvious negative meaning in major languages, not easily confused with a big existing brand.
4. **Check availability** (see below).
5. **Trademark sanity check** (best-effort): the agent SHOULD search the name + category and MUST flag if a well-known company in an adjacent space already uses it. The agent MUST recommend a proper USPTO/registry search before committing and MUST state it is not giving legal advice.
6. **Recommend one** with a one-line rationale, and a backup.

## Checking domain availability

The agent MUST search first — but DNS/whois is more reliable than search snippets for "is it registered," so the agent SHOULD prefer the helper below when tools are present.

Best-effort helper:
```bash
scripts/check-domain.sh example.com example.io getexample.com
```
It tries `whois` (and falls back to `dig`) and reports each domain as likely **available** / **taken** / **unknown**. Treat "available" as *probably* available — only a registrar's checkout confirms it.

Manual fallbacks if the script/tools aren't present:
- `whois example.com` → "No match" / "NOT FOUND" usually means available.
- `dig +short example.com` → no A/NS records is a weak signal it may be unregistered.
- Otherwise, search and/or tell the user to check at a registrar.

## Domain guidance
- Prefer a clean `.com` when realistic; it still signals legitimacy.
- Good modern alternates: `.io`, `.dev`, `.app`, `.ai` (note `.ai` can be pricey), `.sh`, `.so`.
- `get<name>.com` / `<name>app.com` / `use<name>.com` / `try<name>.com` are acceptable compromises — flag them as compromises, not ideal.
- Also note social handle availability if easy to check (it often constrains the real-world name).

## Output format
Present a shortlist table:

```
| Name        | Style       | .com        | Alt domain     | Notes |
|-------------|-------------|-------------|----------------|-------|
| ShipOrSkip  | compound    | taken       | shiporskip.sh ✅ | clear, on-theme |
| Vet         | short verb  | taken       | vetidea.com ✅  | generic, crowded TM |
```
Then: **recommended pick + why**, and a backup.
