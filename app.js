const roundStorageKey = "leilao-do-censo-round";
const defaultTeamColors = ["#f56554", "#087f8c", "#a4b51e", "#151d66"];
const createInitialTeams = () => ["Equipe 1", "Equipe 2", "Equipe 3", "Equipe 4"].map((name, index) => ({ name, color: defaultTeamColors[index], balance: 1000, lots: 0 }));
const initialRoundState = { team: "", bid: null, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], teams: createInitialTeams(), currentQuestionId: null, usedQuestionIds: [], catalogExhausted: false };

let questionCatalog = [];
let catalogLoadError = false;
const questions = () => questionCatalog;
const isApproximation = (question) => question?.modalidade === "aproximacao";
const isAuctionQuestion = (question) => question && !isApproximation(question);
const modalityLabel = (modality) => ({ multipla_escolha: "Múltipla escolha", aberta: "Resposta aberta", aproximacao: "Aproximação", verdadeiro_falso: "Verdadeiro ou falso" }[modality] || "Questão");
const copyTeams = (teams) => teams.map((team, index) => ({ name: String(team.name || `Equipe ${index + 1}`), color: team.color || defaultTeamColors[index], balance: Math.trunc(Number(team.balance) || 0), lots: Math.max(0, Math.trunc(Number(team.lots) || 0)) }));
const normaliseState = (state) => ({ ...initialRoundState, ...state, teams: Array.isArray(state?.teams) && state.teams.length === 4 ? copyTeams(state.teams) : createInitialTeams(), usedQuestionIds: Array.isArray(state?.usedQuestionIds) ? state.usedQuestionIds : [], winningTeams: Array.isArray(state?.winningTeams) ? state.winningTeams : [] });
const readRoundState = () => { try { return normaliseState(JSON.parse(localStorage.getItem(roundStorageKey) || "{}")); } catch { return normaliseState({}); } };
const saveRoundState = (updates) => { const next = normaliseState({ ...readRoundState(), ...updates }); localStorage.setItem(roundStorageKey, JSON.stringify(next)); return next; };
const formatMoney = (value) => `R$ ${Math.trunc(Number(value) || 0).toLocaleString("pt-BR")}`;
const remainingSeconds = (state) => Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000));
const formatTime = (seconds) => `00:${String(seconds).padStart(2, "0")}`;
const getQuestion = (state) => questions().find((question) => question.id === state.currentQuestionId) || null;

async function loadQuestionCatalog() {
  try {
    const response = await fetch("/api/questions", { cache: "no-store" });
    if (!response.ok) throw new Error("Não foi possível carregar as questões.");
    const data = await response.json();
    questionCatalog = Array.isArray(data) ? data : [];
  } catch {
    catalogLoadError = true;
    questionCatalog = [];
  }
}

function chooseNextQuestion(state) {
  const available = questions().filter((question) => !state.usedQuestionIds.includes(question.id));
  if (!available.length) return { currentQuestionId: null, catalogExhausted: true };
  const question = available[Math.floor(Math.random() * available.length)];
  return { currentQuestionId: question.id, usedQuestionIds: [...state.usedQuestionIds, question.id], catalogExhausted: false };
}

function createTeamCard(team) {
  const card = document.createElement("div");
  card.className = "summary-team";
  card.style.setProperty("--team-color", team.color);
  const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("strong"); name.textContent = team.name;
  const details = document.createElement("dl");
  [["Saldo", formatMoney(team.balance)], ["Lotes", String(team.lots)]].forEach(([label, value]) => {
    const row = document.createElement("div"); const term = document.createElement("dt"); const definition = document.createElement("dd");
    term.textContent = label; definition.textContent = value; row.append(term, definition); details.append(row);
  });
  card.append(dot, name, details);
  return card;
}

function renderTeamSummary(state) {
  const list = document.querySelector("[data-teams-summary-list]");
  if (list) list.replaceChildren(...state.teams.map(createTeamCard));
}

function renderTeamSelect(state) {
  const select = document.querySelector("#final-team");
  if (!select) return;
  const key = state.teams.map((team) => team.name).join("|");
  if (select.dataset.teamsKey === key) return;
  const currentValue = select.value;
  select.replaceChildren();
  const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "Selecione a equipe"; select.append(placeholder);
  state.teams.forEach((team) => { const option = document.createElement("option"); option.value = team.name; option.textContent = team.name; select.append(option); });
  select.value = state.teams.some((team) => team.name === currentValue) ? currentValue : "";
  select.dataset.teamsKey = key;
}

function renderApproximationChoices(state) {
  const list = document.querySelector("[data-approximation-winners]");
  if (!list) return;
  const selected = new Set(state.winningTeams.length ? state.winningTeams : [...list.querySelectorAll("button[aria-pressed='true']")].map((button) => button.value));
  list.replaceChildren(...state.teams.map((team) => {
    const button = document.createElement("button"); button.type = "button"; button.value = team.name; button.className = "approximation-choice"; button.style.setProperty("--team-color", team.color);
    const isSelected = selected.has(team.name); button.setAttribute("aria-pressed", String(isSelected)); button.classList.toggle("is-selected", isSelected); button.disabled = Boolean(state.result) || !state.released;
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const text = document.createElement("span"); text.textContent = team.name;
    const mark = document.createElement("span"); mark.className = "approximation-mark"; mark.setAttribute("aria-hidden", "true"); mark.textContent = "✓";
    button.addEventListener("click", () => {
      const nextSelected = button.getAttribute("aria-pressed") !== "true";
      button.setAttribute("aria-pressed", String(nextSelected));
      button.classList.toggle("is-selected", nextSelected);
    });
    button.append(dot, text, mark); return button;
  }));
}

function renderOptions(question) {
  document.querySelectorAll("[data-question-options]").forEach((list) => {
    const alternatives = Array.isArray(question?.alternativas) ? question.alternativas : [];
    list.hidden = alternatives.length === 0;
    list.dataset.modality = question?.modalidade || "";
    list.replaceChildren(...alternatives.map((alternative) => { const item = document.createElement("li"); item.textContent = alternative; return item; }));
  });
}

function renderQuestion(state) {
  const question = getQuestion(state);
  const exhausted = document.querySelector("[data-catalog-exhausted]");
  const questionContent = document.querySelector("[data-question-content]");
  if (!question) {
    if (exhausted) exhausted.hidden = !state.catalogExhausted;
    if (questionContent) questionContent.hidden = true;
    return null;
  }
  if (exhausted) exhausted.hidden = true;
  if (questionContent) questionContent.hidden = false;
  document.querySelectorAll("[data-lot-number]").forEach((element) => { element.textContent = question.id; });
  document.querySelectorAll("[data-lot-value]").forEach((element) => { element.textContent = formatMoney(question.valorLote); });
  document.querySelectorAll("[data-question-modality]").forEach((element) => { element.textContent = modalityLabel(question.modalidade); });
  document.querySelectorAll("[data-question-text]").forEach((element) => { element.textContent = question.enunciado; });
  renderOptions(question);
  document.querySelectorAll("[data-reference-answer]").forEach((element) => { element.textContent = question.resposta; });
  return question;
}

function renderAuctioneer() {
  const state = readRoundState(); const releaseButton = document.querySelector("#release-question");
  if (!releaseButton) return;
  const question = renderQuestion(state); const timerButton = document.querySelector("#start-timer"); const resultButtons = document.querySelectorAll("[data-result]"); const message = document.querySelector("#timer-message"); const displays = document.querySelectorAll("[data-timer-display]"); const status = document.querySelector("#question-status"); const nextLotButton = document.querySelector("#prepare-next-lot"); const finalTeam = document.querySelector("#final-team"); const finalBid = document.querySelector("#final-bid"); const confirmButton = document.querySelector("#confirm-final-bid"); const bidForm = document.querySelector("[data-bid-form]"); const approximationPanel = document.querySelector("[data-approximation-result]"); const standardResult = document.querySelector("[data-standard-result]"); const approximationButton = document.querySelector("#confirm-approximation"); const resultTitle = document.querySelector("#result-title");
  renderTeamSelect(state); renderTeamSummary(state); renderApproximationChoices(state);
  const noRound = !question;
  const approximation = isApproximation(question);
  if (bidForm) bidForm.hidden = approximation;
  if (approximationPanel) approximationPanel.hidden = !approximation;
  if (standardResult) standardResult.hidden = approximation;
  if (resultTitle) resultTitle.textContent = approximation ? "Registrar resultado" : "Marcar resultado";
  releaseButton.disabled = noRound || state.released || (!approximation && !state.confirmed);
  releaseButton.firstChild.textContent = approximation ? "Liberar rodada no Painel da disputa " : "Liberar pergunta no Painel da disputa ";
  timerButton.disabled = noRound || !state.released || Boolean(state.timerEndsAt) || state.timerExpired || Boolean(state.result);
  resultButtons.forEach((button) => { button.disabled = noRound || approximation || !state.released || Boolean(state.result); button.classList.toggle("is-selected", state.result === button.dataset.result); });
  if (approximationButton) approximationButton.disabled = noRound || !approximation || !state.released || Boolean(state.result);
  [finalTeam, finalBid, confirmButton].forEach((element) => { if (element) element.disabled = noRound || approximation || Boolean(state.result); });
  if (state.confirmed && !approximation) { finalTeam.value = state.team; finalBid.value = Number.isInteger(state.bid) ? state.bid : ""; }
  nextLotButton.hidden = !state.result;
  if (catalogLoadError) { status.textContent = "Catálogo indisponível"; message.textContent = "Não foi possível carregar as questões. Inicie pelo servidor local."; return; }
  if (noRound) { status.textContent = "Catálogo esgotado"; message.textContent = "Não há mais perguntas disponíveis. Adicione novas questões ao catálogo para continuar."; displays.forEach((element) => { element.textContent = "00:45"; }); return; }
  if (state.result) { status.textContent = "Rodada encerrada"; message.textContent = approximation ? "Resultado de aproximação registrado e saldos atualizados." : state.result === "correct" ? "Resultado: lote adquirido e saldo atualizado." : "Resultado: lance redistribuído e saldos atualizados."; }
  else if (!state.released) { status.textContent = "Privada — pronta para liberação"; message.textContent = approximation ? "Libere a rodada quando todas as equipes estiverem prontas para responder." : state.confirmed ? "Lance confirmado. Libere a pergunta quando estiver pronto." : "Confirme o lance e libere a pergunta para iniciar o tempo."; }
  else if (state.timerExpired) { status.textContent = "Exibida no Painel da disputa"; message.textContent = approximation ? "Tempo encerrado. Registre a equipe mais próxima." : "Tempo encerrado. Marque o resultado da resposta manualmente."; }
  else if (state.timerEndsAt) { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Tempo em andamento no Painel da disputa."; }
  else { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Rodada liberada. Inicie o tempo quando as equipes estiverem prontas."; }
  const seconds = state.timerEndsAt ? remainingSeconds(state) : 45;
  displays.forEach((element) => { element.textContent = state.timerExpired ? "Tempo encerrado" : formatTime(seconds); });
}

function renderPublicResult(state) {
  const question = getQuestion(state); const title = document.querySelector("[data-public-result-title]"); const message = document.querySelector("[data-public-result-message]"); const recipients = document.querySelector("[data-public-recipients]"); const shareValue = document.querySelector("[data-public-share]"); const correctAnswer = document.querySelector("[data-public-correct-answer]");
  if (state.result === "approximation") {
    const winners = state.winningTeams.join(" e ");
    const share = Math.floor(question.valorLote / state.winningTeams.length);
    title.textContent = "Resultado da aproximação";
    message.textContent = `${winners} ${state.winningTeams.length === 1 ? "ficou mais próxima" : "ficaram mais próximas"} do valor-alvo.`;
    recipients.hidden = false; recipients.querySelector("p").textContent = state.winningTeams.length === 1 ? "Valor recebido pela equipe:" : "Valor recebido por cada equipe empatada:"; shareValue.textContent = formatMoney(share);
    correctAnswer.textContent = `Valor-alvo: ${question.resposta}`; correctAnswer.hidden = false; return;
  }
  if (state.result === "correct") { title.textContent = "Lote adquirido"; message.textContent = `${state.team} acertou a resposta e adquiriu o lote.`; recipients.hidden = true; correctAnswer.hidden = true; return; }
  const share = Math.floor(state.bid / (state.teams.length - 1));
  title.textContent = "Lote não adquirido"; message.textContent = `${state.team} não acertou a resposta.`; shareValue.textContent = formatMoney(share); recipients.querySelector("p").textContent = "Valor recebido pelas outras equipes:"; correctAnswer.textContent = `Resposta correta: ${question?.resposta || ""}`; recipients.hidden = false; correctAnswer.hidden = false;
}

function renderPublicRanking(state) {
  const ranking = document.querySelector("[data-public-ranking]");
  if (!ranking) return;
  ranking.replaceChildren(...state.teams.map((team) => {
    const item = document.createElement("li"); item.className = "public-ranking-team"; item.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true"); const name = document.createElement("strong"); name.textContent = team.name;
    const stats = document.createElement("span"); stats.className = "public-team-stats";
    const lots = document.createElement("span"); const lotValue = document.createElement("b"); lotValue.textContent = team.lots; lots.append(lotValue, ` ${team.lots === 1 ? "lote" : "lotes"}`);
    const balance = document.createElement("span"); const balanceValue = document.createElement("b"); balanceValue.textContent = formatMoney(team.balance); balance.append(balanceValue);
    stats.append(lots, balance); item.append(dot, name, stats); return item;
  }));
}

function renderPublicRoundContext(state, question) {
  const context = document.querySelector("[data-public-round-context]");
  if (!context) return;
  context.replaceChildren();
  if (isApproximation(question)) {
    const message = document.createElement("strong"); message.textContent = "Todas as equipes respondem";
    const detail = document.createElement("span"); detail.textContent = "Vence quem chegar mais perto do valor-alvo.";
    context.append(message, detail); return;
  }
  const winner = state.teams.find((team) => team.name === state.team);
  const dot = document.createElement("span"); dot.className = "team-dot"; dot.style.setProperty("--team-color", winner?.color || defaultTeamColors[0]); dot.setAttribute("aria-hidden", "true");
  const name = document.createElement("strong"); name.textContent = state.team; const detail = document.createElement("span"); detail.textContent = "assumiu o lote por "; const bid = document.createElement("b"); bid.textContent = formatMoney(state.bid); detail.append(bid); context.append(dot, name, detail);
}

function renderPublicPanel() {
  const shell = document.querySelector(".public-shell"); if (!shell) return;
  const state = readRoundState(); const question = getQuestion(state); renderQuestion(state);
  const waiting = document.querySelector("[data-public-waiting]"); const round = document.querySelector("[data-public-round]"); const result = document.querySelector("[data-public-result]");
  waiting.hidden = state.released || Boolean(state.result); round.hidden = !state.released || Boolean(state.result) || !question; result.hidden = !state.result; shell.dataset.publicState = state.result ? "result" : state.released ? "released" : "waiting";
  if (state.result) { renderPublicResult(state); return; }
  if (!state.released) { renderPublicRanking(state); return; }
  renderPublicRoundContext(state, question);
  const timer = document.querySelector("[data-public-timer]"); const note = document.querySelector("[data-public-timer-note]");
  if (state.timerExpired) { timer.textContent = "Tempo encerrado"; timer.classList.add("is-ended"); note.textContent = "Aguardando a decisão do leiloeiro."; }
  else if (state.timerEndsAt) { timer.textContent = formatTime(remainingSeconds(state)); timer.classList.remove("is-ended"); note.textContent = "Tempo de resposta em andamento."; }
  else { timer.textContent = "00:45"; timer.classList.remove("is-ended"); note.textContent = "Aguardando o início do tempo."; }
}

function settleExpiredTimer() { const state = readRoundState(); if (state.timerEndsAt && remainingSeconds(state) === 0) saveRoundState({ timerEndsAt: null, timerExpired: true }); }
function applyResult(result) {
  const state = readRoundState(); const question = getQuestion(state); if (state.result || !question || !isAuctionQuestion(question)) return;
  const share = Math.floor(state.bid / (state.teams.length - 1));
  const teams = state.teams.map((team) => {
    if (team.name !== state.team) return result === "wrong" ? { ...team, balance: team.balance + share } : team;
    return result === "correct" ? { ...team, balance: team.balance + question.valorLote, lots: team.lots + 1 } : { ...team, balance: team.balance - state.bid };
  });
  saveRoundState({ teams, result, timerEndsAt: null, timerExpired: true });
}

function applyApproximationResult() {
  const state = readRoundState(); const question = getQuestion(state); const selected = [...document.querySelectorAll("[data-approximation-winners] button[aria-pressed='true']")].map((button) => button.value);
  if (!isApproximation(question) || state.result || !state.released || !selected.length) return;
  const share = Math.floor(question.valorLote / selected.length);
  const teams = state.teams.map((team) => selected.includes(team.name) ? { ...team, balance: team.balance + share, lots: team.lots + 1 } : team);
  saveRoundState({ teams, winningTeams: selected, result: "approximation", timerEndsAt: null, timerExpired: true });
}

function startNewGame(teams) {
  const base = { ...initialRoundState, teams, usedQuestionIds: [] };
  localStorage.setItem(roundStorageKey, JSON.stringify(normaliseState({ ...base, ...chooseNextQuestion(base) })));
}

function initialiseSetup() {
  const startButton = document.querySelector("#start-game"); if (!startButton) return;
  const state = readRoundState();
  const activeGame = Boolean(state.currentQuestionId || state.usedQuestionIds.length || state.result);
  const fromMatch = new URLSearchParams(window.location.search).get("from") === "partida";
  const activeChoice = document.querySelector("[data-active-game-choice]");
  const startLabel = document.querySelector("[data-start-game-label]");
  if (activeChoice) activeChoice.hidden = !(activeGame && fromMatch);
  if (startLabel) startLabel.textContent = activeGame ? "Iniciar nova partida" : "Iniciar partida";
  state.teams.forEach((team, index) => { const name = document.querySelector(`#team-${index + 1}`); const color = document.querySelector(`#color-${index + 1}`); name.value = team.name; color.value = team.color; name.closest(".team-field").style.setProperty("--team-color", team.color); });
  startButton.addEventListener("click", () => {
    const teams = [0, 1, 2, 3].map((index) => ({ name: document.querySelector(`#team-${index + 1}`).value.trim(), color: document.querySelector(`#color-${index + 1}`).value, balance: 1000, lots: 0 }));
    const names = teams.map((team) => team.name.toLocaleLowerCase("pt-BR")); const message = document.querySelector("#setup-message");
    if (catalogLoadError || !questions().length) { message.textContent = "Não foi possível carregar o catálogo de questões. Inicie o servidor local e tente novamente."; return; }
    if (teams.some((team) => !team.name) || new Set(names).size !== teams.length) { message.textContent = "Informe quatro nomes diferentes para iniciar a partida."; return; }
    startNewGame(teams); window.location.href = "partida.html";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestionCatalog();
  initialiseSetup();
  const confirmButton = document.querySelector("#confirm-final-bid");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => { const team = document.querySelector("#final-team").value; const bidInput = document.querySelector("#final-bid"); const bid = Number(bidInput.value); if (!team || !Number.isInteger(bid) || bid < 0) { bidInput.setCustomValidity("Informe um lance inteiro em reais."); bidInput.reportValidity(); return; } bidInput.setCustomValidity(""); saveRoundState({ team, bid, confirmed: true, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [] }); renderAuctioneer(); });
    document.querySelector("#release-question").addEventListener("click", () => { saveRoundState({ released: true }); renderAuctioneer(); });
    document.querySelector("#start-timer").addEventListener("click", () => { saveRoundState({ timerEndsAt: Date.now() + 45000, timerExpired: false }); renderAuctioneer(); });
    document.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => { applyResult(button.dataset.result); renderAuctioneer(); }));
    document.querySelector("#confirm-approximation").addEventListener("click", () => { const selected = document.querySelectorAll("[data-approximation-winners] button[aria-pressed='true']"); if (!selected.length) { document.querySelector("[data-approximation-winners]").setAttribute("aria-invalid", "true"); return; } applyApproximationResult(); renderAuctioneer(); });
    document.querySelector("#prepare-next-lot").addEventListener("click", () => { const state = readRoundState(); saveRoundState({ team: "", bid: null, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], ...chooseNextQuestion(state) }); document.querySelector("#final-team").value = ""; document.querySelector("#final-bid").value = ""; renderAuctioneer(); });
  }
  window.addEventListener("storage", () => { renderAuctioneer(); renderPublicPanel(); });
  setInterval(() => { settleExpiredTimer(); renderAuctioneer(); renderPublicPanel(); }, 250);
  renderAuctioneer(); renderPublicPanel();
});
