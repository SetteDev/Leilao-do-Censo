const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const port = Number(process.env.PORT) || 4173;
const questionsDirectory = path.join(root, "content", "perguntas");
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};
let sharedRoundState = null;
let sharedRoundVersion = 0;
const stateClients = new Set();

function unquote(value) {
  return value.replace(/^["']|["']$/g, "").trim();
}

function parseQuestion(source) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  const question = { alternativas: [] };
  let key = "";
  match[1].split(/\r?\n/).forEach((line) => {
    const property = line.match(/^([a-z_]+):\s*(.*)$/i);
    if (property) {
      key = property[1];
      const value = unquote(property[2]);
      if (key === "alternativas") question.alternativas = [];
      else if (key === "valor_lote") question.valor_lote = Number(value);
      else question[key] = value;
      return;
    }
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && key === "alternativas") question.alternativas.push(unquote(item[1]));
  });
  if (!question.id || !question.modalidade || !question.enunciado || !question.resposta) return null;
  if (question.modalidade !== "aproximacao" && !Number.isInteger(question.valor_lote)) return null;
  return { id: question.id, modalidade: question.modalidade, valorLote: question.valor_lote, enunciado: question.enunciado, alternativas: question.alternativas, resposta: question.resposta };
}

function sendQuestions(response) {
  fs.readdir(questionsDirectory, (directoryError, entries) => {
    if (directoryError) {
      response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ error: "Não foi possível carregar o catálogo." }));
      return;
    }
    const files = entries.filter((entry) => entry.endsWith(".md")).sort();
    Promise.all(files.map((file) => fs.promises.readFile(path.join(questionsDirectory, file), "utf8")))
      .then((sources) => sources.map(parseQuestion).filter(Boolean))
      .then((catalog) => {
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
        response.end(JSON.stringify(catalog));
      })
      .catch(() => {
        response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify({ error: "Não foi possível ler o catálogo." }));
      });
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(payload));
}

function statePayload() {
  return { version: sharedRoundVersion, state: sharedRoundState };
}

function broadcastState() {
  const message = `event: state\ndata: ${JSON.stringify(statePayload())}\n\n`;
  stateClients.forEach((client) => client.write(message));
}

function receiveState(request, response) {
  let body = "";
  request.on("data", (chunk) => {
    body += chunk;
    if (body.length > 1024 * 1024) request.destroy();
  });
  request.on("end", () => {
    try {
      const payload = JSON.parse(body || "{}");
      if (!payload.state || typeof payload.state !== "object" || Array.isArray(payload.state)) throw new Error("Estado inválido");
      sharedRoundState = payload.state;
      sharedRoundVersion += 1;
      broadcastState();
      sendJson(response, 200, statePayload());
    } catch {
      sendJson(response, 400, { error: "Estado da partida inválido." });
    }
  });
  request.on("error", () => sendJson(response, 400, { error: "Não foi possível ler o estado da partida." }));
}

function openStateStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive"
  });
  response.write(`event: state\ndata: ${JSON.stringify(statePayload())}\n\n`);
  stateClients.add(response);
  request.on("close", () => stateClients.delete(response));
}

http.createServer((request, response) => {
  const requestPath = new URL(request.url, "http://localhost").pathname;
  if (requestPath === "/api/questions") {
    sendQuestions(response);
    return;
  }
  if (requestPath === "/api/state" && request.method === "GET") {
    sendJson(response, 200, statePayload());
    return;
  }
  if (requestPath === "/api/state" && request.method === "PUT") {
    receiveState(request, response);
    return;
  }
  if (requestPath === "/api/state/events" && request.method === "GET") {
    openStateStream(request, response);
    return;
  }
  const relativePath = requestPath === "/" ? "index.html" : decodeURIComponent(requestPath).replace(/^[/\\]+/, "");
  const filePath = path.resolve(root, relativePath);

  if (!filePath.startsWith(root + path.sep) && filePath !== root) {
    response.writeHead(403);
    response.end("Acesso negado");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(error.code === "ENOENT" ? 404 : 500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error.code === "ENOENT" ? "Arquivo não encontrado" : "Erro ao abrir o arquivo");
      return;
    }
    response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] || "application/octet-stream" });
    response.end(content);
  });
}).listen(port, "0.0.0.0", () => {
  console.log(`Leilão do Censo disponível na porta ${port}`);
});
