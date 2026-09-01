# Ottimizzazione Ollama su GPU integrata AMD (RDNA3 / Radeon 780M e simili)

Note pratiche raccolte facendo girare modelli da 26-27B parametri (Qwen3.8-27B, Gemma 4 26B) su un mini PC con GPU integrata AMD, invece di una scheda grafica dedicata. Utile se hai un Ryzen serie 7040/8040/8045HS o simile, con Radeon 780M/880M/890M.

## Il sintomo

`ollama ps` mostra `100% CPU` invece di usare la GPU, anche se il sistema la vede correttamente (verificabile con `vulkaninfo --summary`). Velocità di generazione tipiche in questo stato: 1-3 tok/sec su un modello Q4 da 15-20 GB — molto sotto quello che l'hardware potrebbe dare.

## Causa

Ollama, nelle versioni recenti, disattiva di default le GPU integrate durante la fase di discovery, e il backend ROCm spesso non supporta ufficialmente i target `gfx11xx` di queste iGPU (viene scartato con un warning tipo `dropping ROCm device — no rocblas support for gfx target`). Serve forzare esplicitamente il backend Vulkan (via driver Mesa RADV) e abilitare manualmente l'uso della GPU integrata.

## Fix: override systemd del servizio Ollama

```bash
sudo mkdir -p /etc/systemd/system/ollama.service.d
sudo tee /etc/systemd/system/ollama.service.d/override.conf << 'EOF'
[Service]
Environment=OLLAMA_VULKAN=true
Environment=OLLAMA_IGPU_ENABLE=1
Environment=GGML_VK_VISIBLE_DEVICES=0
Environment=LD_LIBRARY_PATH=/usr/local/lib/ollama/vulkan:/usr/local/lib/ollama
Environment=OLLAMA_FLASH_ATTENTION=1
Environment=OLLAMA_KV_CACHE_TYPE=q8_0
Environment=OLLAMA_GPU_OVERHEAD=2147483648
Environment=OLLAMA_KEEP_ALIVE=30m
EOF

sudo systemctl daemon-reload
sudo systemctl restart ollama
```

Punti da non sbagliare:
- `OLLAMA_VULKAN=true` (o `1`, a seconda della versione) — non impostare `HSA_OVERRIDE_GFX_VERSION` né `HIP_VISIBLE_DEVICES`, altrimenti si riattiva il percorso ROCm che va in crash su queste iGPU.
- `OLLAMA_GPU_OVERHEAD` è in **byte**, non MiB (`2147483648` = 2 GiB) — riserva un margine di sicurezza perché la memoria "libera" dichiarata da Vulkan su un sistema a memoria condivisa (UMA) non sempre coincide con quella davvero allocabile in un colpo solo.

## Verifica

Due terminali:
```bash
watch -n 1 ollama ps
```
```bash
ollama run <nome-modello> "ciao"
```
La colonna `PROCESSOR` deve mostrare una percentuale su GPU, non `100% CPU`.

## Il crash "Not enough memory for command submission"

Se dopo il fix Vulkan il caricamento va comunque in crash con:
```
radv/amdgpu: Not enough memory for command submission.
ggml_vulkan: device lost on Vulkan0
```
il motivo più comune è un contesto (`num_ctx`) troppo grande incorporato nel tag del modello che stai usando — su queste iGPU, con memoria condivisa e non dedicata, il margine reale disponibile è più risicato di quanto sembri dai numeri riportati da Vulkan.

**Fix**: crea una copia del modello con un contesto più contenuto:
```bash
cat << 'EOF' > /tmp/Modelfile
FROM <nome-modello-originale>
PARAMETER num_ctx 8192
EOF
ollama create <nome-modello>-ctx8k -f /tmp/Modelfile
```

## Limitazione dell'endpoint compatibile OpenAI

Se il tuo backend usa `/v1/chat/completions` (compatibilità OpenAI) invece dell'endpoint nativo `/api/chat`, tieni presente che:

- **`num_ctx` non è impostabile per singola richiesta** su quell'endpoint — va fissato nel Modelfile del modello (da cui il workaround sopra: creare tag dedicati con contesto diverso).
- Per controllare il ragionamento (modelli "thinking", es. Qwen3.5+) su quell'endpoint si usa il campo `reasoning_effort`, non il parametro nativo `think`:
  ```json
  { "reasoning_effort": "none" }   // disattivato
  { "reasoning_effort": "low" }    // basso
  { "reasoning_effort": "medium" } // medio
  { "reasoning_effort": "high" }   // alto
  ```
  Questo non è documentato ufficialmente nella pagina di compatibilità OpenAI di Ollama al momento in cui scrivo — va dedotto dal codice sorgente (`openai/openai.go`).

## Risultati misurati (hardware di riferimento: AMD Ryzen 7 8745HS, Radeon 780M, 32 GB RAM)

| Configurazione | Velocità generazione |
|---|---|
| CPU, nessun offload GPU | ~1-3 tok/sec |
| GPU (Vulkan) attiva, modello ~17 GB, 100% offload | ~5 tok/sec |
| GPU (Vulkan) attiva, modello ~18 GB, offload parziale (~88% GPU) | fino a ~18 tok/sec a modello già caricato (varia molto in base al prompt) |

I numeri variano molto in base al modello, alla dimensione del contesto in uso, e a quanto è "caldo" il modello in memoria (il primo caricamento dopo l'avvio del servizio, o dopo il timeout di `OLLAMA_KEEP_ALIVE`, è sempre più lento).
