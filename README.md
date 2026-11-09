# JANTREX · podklady k webu

Vícekrokový formulář pro Honzu (JANTREX realizace s.r.o.), aby poslal podklady k webu. Odpovědi i nahrané soubory se ukládají na Cloudflare.

- `/` je formulář: 8 kroků (Firma, Služby, Zákazníci, Logo a vzhled, Fotky, Doména a online, Co dál, Odeslat). Ukládá se průběžně, jde nahrávat soubory a v každém kroku namluvit hlasovku.
- `/odpovedi` je přehled pro tebe, zamčený heslem: všechny odpovědi, náhledy fotek, přehrávač hlasovek, odkazy ke stažení, tlačítko „Kopírovat jako text“ a historie odeslaných verzí.
- `src/worker.js` je API. Odpovědi i soubory jsou v jednom KV (`podklady:aktualni`, `odeslano:<čas>`, `soubor:<id>`).

Limity KV zdarma: soubor max 24 MB, 1 000 zápisů denně, 1 GB celkem. Na tohle stačí.

## Spuštění na Cloudflare

1. **KV:** Cloudflare → Storage & Databases → KV → Create → název `jantrex-podklady`. Zkopíruj jeho ID.
2. **wrangler.jsonc:** místo `SEM_VLOZ_ID_KV` vlož to ID.
3. **Nasazení:** nahraj složku do GitHub repa (např. `vojtechsvoboda-cz/jantrex-podklady`) a ve Workers & Pages → Create → Import a repository ho propoj. Případně z terminálu ve složce projektu: `npx wrangler deploy`.
4. **Heslo pro /odpovedi:** Worker → Settings → Variables and Secrets → Add → typ **Secret**, název `HESLO`, hodnota podle tebe. Bez něj se /odpovedi neotevřou.
5. **Test:** otevři `https://jantrex-podklady.<tvuj-subdomain>.workers.dev`, vyplň něco a nahraj fotku, pak se podívej na `/odpovedi`.
6. Honzovi pošli odkaz na hlavní stránku. `/odpovedi` mu neposílej.

Testovací data smažeš v KV (Storage & Databases → KV → jantrex-podklady → smazat klíče).

Návrh: [vojtechsvoboda.cz](https://vojtechsvoboda.cz)
