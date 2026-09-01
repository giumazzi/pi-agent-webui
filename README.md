# Pi Agent WebUI

Interfaccia web leggera per Ollama, con capacità agentiche (esecuzione comandi shell, lettura/scrittura file, ricerca web) e controlli pensati per hardware con risorse limitate — in particolare mini PC con GPU integrata invece di una scheda dedicata.

Nata per far girare modelli locali da 26-27B parametri (Qwen3.8-27B, Gemma 4 26B) in modo utilizzabile su un mini PC con GPU integrata AMD (Radeon 780M / RDNA3), senza scheda video dedicata.

## Funzionalità

- **Chat** con qualunque modello disponibile sul tuo server Ollama
- **Agente**: il modello può proporre di eseguire comandi shell, leggere/scrivere file, cercare sul web — ogni azione richiede la tua approvazione esplicita prima di essere eseguita
- **Controllo del ragionamento** (none/low/medium/high) — per modelli "thinking", regola quanto il modello ragiona prima di rispondere, con impatto diretto su tempo di risposta e token generati
- **Interruttore strumenti** — disattiva l'invio dello schema dei tool quando fai solo una chiacchierata, per risparmiare token e tempo
- **Incolla immagini** direttamente in chat (Ctrl+V) per modelli con supporto visione
- **Cronologia della conversazione** salvata nel browser (localStorage), ripristinata automaticamente al ricaricamento della pagina, con pulsante "Nuova chat" per azzerarla
- **Metriche per ogni risposta**: tempo totale, token generati, token/sec

## Requisiti

- [Node.js](https://nodejs.org/) 18 o superiore
- [Ollama](https://ollama.com/) installato e in esecuzione, con almeno un modello scaricato
- Se hai una GPU integrata AMD e vuoi usarla per l'inferenza (invece della sola CPU), leggi [`docs/HARDWARE-OPTIMIZATION.md`](docs/HARDWARE-OPTIMIZATION.md) — copre i problemi più comuni e come risolverli

## Installazione

```bash
git clone <url-di-questo-repository>
cd pi-agent-webui
npm install
cp .env.example .env
```

Modifica `.env` se il tuo server Ollama non è sulla porta/host di default.

## Avvio

```bash
npm start
```

Poi apri [http://localhost:3000](http://localhost:3000) nel browser.

## Nota sui modelli

Questo repository **non include** pesi di alcun modello — solo il codice dell'interfaccia. I modelli restano gestiti interamente da Ollama (`ollama pull <nome-modello>`) e sono soggetti alle rispettive licenze dei loro autori (es. Apache 2.0 per Qwen, Gemma Terms of Use per i modelli Gemma di Google).

## Limitazioni note

- La cronologia salvata è una singola conversazione continua, non un archivio di più chat separate
- Nessuna autenticazione: pensata per uso locale/personale, non per esposizione diretta su internet senza un livello di protezione aggiuntivo
- L'esecuzione di comandi shell tramite il tool `run_shell_command` avviene con gli stessi permessi dell'utente che esegue `server.js` — usa con consapevolezza, l'approvazione manuale è pensata come rete di sicurezza ma non sostituisce un sandboxing vero e proprio

## Licenza

Questo progetto è distribuito con licenza MIT — vedi [`LICENSE`](LICENSE). Non copre i modelli AI usati tramite Ollama, ciascuno con la propria licenza.
