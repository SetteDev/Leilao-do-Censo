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
      else question[key] = key === "valor_lote" ? Number(value) : value;
      return;
    }
    const item = line.match(/^\s*-\s*(.*)$/);
    if (item && key === "alternativas") question.alternativas.push(unquote(item[1]));
  });
  if (!question.id || !question.modalidade || !question.enunciado || !question.resposta || !Number.isInteger(question.valor_lote)) return null;
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

http.createServer((request, response) => {
  const requestPath = new URL(request.url, "http://localhost").pathname;
  if (requestPath === "/api/questions") {
    sendQuestions(response);
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
}).listen(port, "127.0.0.1", () => {
  console.log(`Leilão do Censo disponível em http://127.0.0.1:${port}`);
});
