require('dotenv').config();
const express = require('express');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const { search } = require('duckduckgo-search-api');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.OPENAI_BASE_URL || 'http://localhost:11434/v1';
const API_KEY = process.env.OPENAI_API_KEY || 'ollama';

app.use(express.json());
app.use(express.static('public'));

const pendingApprovals = new Map();

// Helper per comandi Shell
function executeBashCommand(command) {
  return new Promise((resolve) => {
    exec(command, (error, stdout, stderr) => {
      if (error) return resolve(`Errore durante l'esecuzione: ${error.message}`);
      if (stderr && !stdout) return resolve(`Stderr: ${stderr}`);
      resolve(stdout.trim() || 'Comando eseguito con successo (nessun output).');
    });
  });
}

// Helper per scrittura file
function writeFileContent(filePath, content) {
  try {
    const absolutePath = path.resolve(filePath);
    const dir = path.dirname(absolutePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(absolutePath, content, 'utf8');
    return `File salvato correttamente in: ${absolutePath}`;
  } catch (err) {
    return `Errore durante la scrittura del file: ${err.message}`;
  }
}

// Helper per lettura file
function readFileContent(filePath) {
  try {
    const absolutePath = path.resolve(filePath);
    if (!fs.existsSync(absolutePath)) return `Errore: Il file '${absolutePath}' non esiste.`;
    return fs.readFileSync(absolutePath, 'utf8');
  } catch (err) {
    return `Errore durante la lettura del file: ${err.message}`;
  }
}

// Helper per Ricerca Web via DuckDuckGo
async function performWebSearch(query) {
  try {
    const results = await search(query, { safeSearch: 'strict' });
    if (!results || results.length === 0) {
      return "Nessun risultato trovato sul web per questa ricerca.";
    }
    // Ritorna i primi 4 risultati formattati
    const formatted = results.slice(0, 4).map((r, i) => {
      return `[${i + 1}] ${r.title}\nURL: ${r.link}\nEstratto: ${r.snippet}\n`;
    }).join('\n');
    return formatted;
  } catch (err) {
    return `Errore durante la ricerca web: ${err.message}`;
  }
}

// Definizione completa dei 4 Tool
const tools = [
  {
    type: "function",
    function: {
      name: "run_shell_command",
      description: "Esegue un comando bash sul PC Linux locale per raccogliere informazioni (es. 'df -h', 'ls', 'free -m').",
      parameters: {
        type: "object",
        properties: { command: { type: "string", description: "Il comando esatto di shell." } },
        required: ["command"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "write_file_content",
      description: "Crea un nuovo file di testo o sovrascrive un file esistente sul disco locale.",
      parameters: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Percorso del file." },
          content: { type: "string", description: "Contenuto del file." }
        },
        required: ["filePath", "content"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file_content",
      description: "Legge il contenuto testuale di un file locale.",
      parameters: {
        type: "object",
        properties: { filePath: { type: "string", description: "Percorso del file da leggere." } },
        required: ["filePath"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "web_search",
      description: "Cerca informazioni aggiornate sul Web in tempo reale (meteo, notizie, documentazione, eventi recenti).",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "I termini di ricerca da inviare al motore di ricerca." }
        },
        required: ["query"]
      }
    }
  }
];

// Estrazione metriche
function extractMetrics(ollamaData, startTime) {
  const endTime = Date.now();
  const totalTimeSec = parseFloat(((endTime - startTime) / 1000).toFixed(2));
  const usage = ollamaData.usage || {};
  const evalCount = usage.completion_tokens || ollamaData.eval_count || 0;
  const promptEvalCount = usage.prompt_tokens || ollamaData.prompt_eval_count || 0;

  let tokPerSec = "0.00";
  if (evalCount > 0 && totalTimeSec > 0) {
    tokPerSec = (evalCount / totalTimeSec).toFixed(2);
  }

  return { totalTimeSec, evalCount, promptEvalCount, tokPerSec };
}

// API Modelli
app.get('/api/models', async (req, res) => {
  try {
    const response = await fetch(`${BASE_URL}/models`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    if (!response.ok) throw new Error(`Errore HTTP: ${response.status}`);
    const data = await response.json();
    res.json(data.data.map(m => m.id));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// API Chat
app.post('/api/chat', async (req, res) => {
  const { model, messages, reasoningEffort, toolsEnabled } = req.body;
  const startTime = Date.now();

  try {
    const requestBody = {
      model,
      messages,
      temperature: 0.2,
      stream: false,
      reasoning_effort: reasoningEffort || 'none'
    };
    if (toolsEnabled !== false) {
      requestBody.tools = tools;
    }

    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) throw new Error(`Errore HTTP Ollama: ${response.statusText}`);

    const data = await response.json();
    const assistantMessage = data.choices[0].message;

    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const approvalId = Date.now().toString();
      const toolCall = assistantMessage.tool_calls[0];

      pendingApprovals.set(approvalId, {
        model,
        messages,
        assistantMessage,
        toolCall,
        reasoningEffort
      });

      return res.json({
        type: 'approval_required',
        approvalId,
        toolName: toolCall.function.name,
        args: JSON.parse(toolCall.function.arguments)
      });
    }

    const metrics = extractMetrics(data, startTime);

    res.json({
      type: 'message',
      message: assistantMessage.content || "(Operazione completata.)",
      metrics
    });

  } catch (error) {
    console.error('Errore in /api/chat:', error);
    res.status(500).json({ error: error.message });
  }
});

// API Approvazione Tool
app.post('/api/approve', async (req, res) => {
  const { approvalId, approved } = req.body;
  const pending = pendingApprovals.get(approvalId);
  const startTime = Date.now();

  if (!pending) {
    return res.status(404).json({ error: 'Richiesta di autorizzazione scaduta o non trovata.' });
  }

  pendingApprovals.delete(approvalId);
  const { model, messages, assistantMessage, toolCall, reasoningEffort } = pending;
  let toolResult = "";

  if (approved) {
    const args = JSON.parse(toolCall.function.arguments);
    if (toolCall.function.name === 'run_shell_command') {
      toolResult = await executeBashCommand(args.command);
    } else if (toolCall.function.name === 'write_file_content') {
      toolResult = writeFileContent(args.filePath, args.content);
    } else if (toolCall.function.name === 'read_file_content') {
      toolResult = readFileContent(args.filePath);
    } else if (toolCall.function.name === 'web_search') {
      toolResult = await performWebSearch(args.query);
    }
  } else {
    toolResult = "L'utente ha RIFIUTATO l'esecuzione di questo tool dalla WebUI per motivi di sicurezza.";
  }

  const updatedMessages = [
    ...messages,
    assistantMessage,
    {
      role: "tool",
      tool_call_id: toolCall.id,
      content: toolResult
    }
  ];

  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify({
        model,
        messages: updatedMessages,
        stream: false,
        reasoning_effort: reasoningEffort || 'none'
      })
    });

    const data = await response.json();
    const finalMessage = data.choices[0].message;
    const metrics = extractMetrics(data, startTime);

    res.json({
      type: 'message',
      message: finalMessage.content || "(Operazione completata.)",
      updatedMessages,
      metrics
    });

  } catch (error) {
    console.error('Errore in /api/approve:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`\n🚀 Server Web PI-AGENT (con Web Search) attivo su: http://localhost:${PORT}`);
});
