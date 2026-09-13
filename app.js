const roundStorageKey = "leilao-do-censo-round";
const defaultTeamColors = ["#f56554", "#087f8c", "#a4b51e", "#151d66"];
const defaultConfig = { ocultarValor: true, capLance: 50, timerSeconds: 45 };
const normaliseConfig = (config) => ({ ...defaultConfig, ...(config || {}), ocultarValor: Boolean(config?.ocultarValor ?? defaultConfig.ocultarValor), capLance: Math.max(0, Math.trunc(Number(config?.capLance) || 0)), timerSeconds: Math.max(5, Math.trunc(Number(config?.timerSeconds) || defaultConfig.timerSeconds)) });
const createInitialTeams = () => ["Equipe 1", "Equipe 2", "Equipe 3", "Equipe 4"].map((name, index) => ({ name, color: defaultTeamColors[index], balance: 1000, lots: 0 }));
const initialRoundState = { team: "", bid: null, bidDebited: false, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationCalculated: false, valueRevealed: false, gameOver: false, awaitingSetup: false, standings: [], config: normaliseConfig({}), teams: createInitialTeams(), currentQuestionId: null, usedQuestionIds: [], catalogExhausted: false };

let questionCatalog = [];
let catalogLoadError = false;
let pendingLotFilter = null;
const questions = () => questionCatalog;
const isApproximation = (question) => question?.modalidade === "aproximacao";
const isAuctionQuestion = (question) => question && !isApproximation(question);
const modalityLabel = (modality) => ({ multipla_escolha: "Múltipla escolha", aberta: "Resposta aberta", aproximacao: "Aproximação", verdadeiro_falso: "Verdadeiro ou falso" }[modality] || "Questão");
const copyTeams = (teams) => teams.map((team, index) => ({ name: String(team.name || `Equipe ${index + 1}`), color: team.color || defaultTeamColors[index], balance: Math.trunc(Number(team.balance) || 0), lots: Math.max(0, Math.trunc(Number(team.lots) || 0)) }));
const normaliseState = (state) => ({ ...initialRoundState, ...state, config: normaliseConfig(state?.config), teams: Array.isArray(state?.teams) && state.teams.length === 4 ? copyTeams(state.teams) : createInitialTeams(), usedQuestionIds: Array.isArray(state?.usedQuestionIds) ? state.usedQuestionIds : [], winningTeams: Array.isArray(state?.winningTeams) ? state.winningTeams : [], approximationAnswers: Array.isArray(state?.approximationAnswers) ? state.approximationAnswers : [], standings: Array.isArray(state?.standings) ? state.standings : [] });
const readRoundState = () => { try { return normaliseState(JSON.parse(localStorage.getItem(roundStorageKey) || "{}")); } catch { return normaliseState({}); } };
const saveRoundState = (updates) => { const next = normaliseState({ ...readRoundState(), ...updates }); localStorage.setItem(roundStorageKey, JSON.stringify(next)); return next; };
const formatMoney = (value) => `R$ ${Math.trunc(Number(value) || 0).toLocaleString("pt-BR")}`;
const formatApproximationValue = (value) => Number.isFinite(Number(value)) ? Number(value).toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
const remainingSeconds = (state) => Math.max(0, Math.ceil((state.timerEndsAt - Date.now()) / 1000));
const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds).padStart(2, "0").slice(-2)}`;
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

function chooseNextQuestion(state, filter = null) {
  const available = questions().filter((question) => !state.usedQuestionIds.includes(question.id) && (!filter || filter.random || question.modalidade === filter.modalidade));
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

function renderApproximationAnswers(state) {
  const list = document.querySelector("[data-approximation-answers]");
  if (!list) return;
  const saved = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
  const current = new Map([...list.querySelectorAll("[data-approximation-team]")].map((input) => [input.dataset.approximationTeam, input.value]));
  list.replaceChildren(...state.teams.map((team) => {
    const label = document.createElement("label"); label.className = "approximation-answer"; label.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("span"); name.textContent = team.name;
    const input = document.createElement("input"); input.type = "number"; input.step = "any"; input.inputMode = "decimal"; input.placeholder = "Resposta"; input.dataset.approximationTeam = team.name; input.value = saved.get(team.name) ?? current.get(team.name) ?? ""; input.disabled = !state.released || state.approximationCalculated || Boolean(state.result);
    label.append(dot, name, input); return label;
  }));
}

function renderNextLotChooser(state) {
  const panel = document.querySelector("[data-next-lot-chooser]");
  if (!panel) return;
  const strip = document.querySelector("[data-category-chips]");
  if (!strip) return;
  const remaining = questions().filter((question) => !state.usedQuestionIds.includes(question.id));
  const confirm = document.querySelector("#confirm-next-lot");
  const makeChip = (label, filter) => {
    const button = document.createElement("button"); button.type = "button"; button.className = "category-chip";
    button.textContent = label; button.disabled = !remaining.some((question) => filter.random || question.modalidade === filter.modalidade);
    button.addEventListener("click", () => { pendingLotFilter = filter; strip.querySelectorAll(".category-chip").forEach((chip) => chip.classList.toggle("is-selected", chip === button)); if (confirm) confirm.disabled = false; });
    return button;
  };
  strip.replaceChildren(
    makeChip("Aleatório", { random: true }),
    makeChip("Múltipla escolha", { modalidade: "multipla_escolha" }),
    makeChip("Resposta aberta", { modalidade: "aberta" }),
    makeChip("Aproximação", { modalidade: "aproximacao" }),
    makeChip("Verdadeiro ou falso", { modalidade: "verdadeiro_falso" })
  );
  if (confirm) confirm.disabled = true;
}

function renderOptions(question) {
  document.querySelectorAll("[data-question-options]").forEach((list) => {
    const alternatives = Array.isArray(question?.alternativas) ? question.alternativas : [];
    list.hidden = alternatives.length === 0;
    list.dataset.modality = question?.modalidade || "";
    list.classList.toggle("is-boolean", question?.modalidade === "verdadeiro_falso");
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
  document.querySelectorAll("[data-lot-value]").forEach((element) => {
    const masked = element.closest(".public-shell") && state.config.ocultarValor && !state.valueRevealed && !state.result;
    element.textContent = masked ? "R$ ?" : formatMoney(question.valorLote);
  });
  document.querySelectorAll("[data-question-modality]").forEach((element) => { element.textContent = modalityLabel(question.modalidade); });
  document.querySelectorAll("[data-question-text]").forEach((element) => { element.textContent = question.enunciado; });
  renderOptions(question);
  document.querySelectorAll("[data-reference-answer]").forEach((element) => { element.textContent = question.resposta; });
  return question;
}

function renderAuctioneer() {
  const state = readRoundState(); const releaseButton = document.querySelector("#release-question");
  if (!releaseButton) return;
  const question = renderQuestion(state); const timerButton = document.querySelector("#start-timer"); const resultButtons = document.querySelectorAll("[data-result]"); const message = document.querySelector("#timer-message"); const displays = document.querySelectorAll("[data-timer-display]"); const status = document.querySelector("#question-status"); const nextLotButton = document.querySelector("#prepare-next-lot"); const startAnotherGameButton = document.querySelector("#start-another-game"); const finalTeam = document.querySelector("#final-team"); const finalBid = document.querySelector("#final-bid"); const confirmButton = document.querySelector("#confirm-final-bid"); const bidForm = document.querySelector("[data-bid-form]"); const approximationPanel = document.querySelector("[data-approximation-result]"); const standardResult = document.querySelector("[data-standard-result]"); const approximationButton = document.querySelector("#confirm-approximation"); const approximationReleaseButton = document.querySelector("#release-approximation-result"); const resultTitle = document.querySelector("#result-title"); const revealButton = document.querySelector("#reveal-value"); const valueVisibility = document.querySelector("[data-value-visibility]"); const endGameButton = document.querySelector("#end-game"); const endPanel = document.querySelector("[data-match-end-panel]");
  renderTeamSelect(state); renderTeamSummary(state); renderApproximationAnswers(state);
  const noRound = !question;
  const approximation = isApproximation(question);
  if (bidForm) bidForm.hidden = approximation;
  if (approximationPanel) approximationPanel.hidden = !approximation;
  if (standardResult) standardResult.hidden = approximation;
  if (resultTitle) resultTitle.textContent = approximation ? "Registrar resultado" : "Marcar resultado";
  releaseButton.disabled = noRound || state.gameOver || state.released || (!approximation && !state.confirmed);
  releaseButton.firstChild.textContent = approximation ? "Liberar rodada no Painel da disputa " : "Liberar pergunta no Painel da disputa ";
  timerButton.disabled = noRound || state.gameOver || !state.released || Boolean(state.timerEndsAt) || state.timerExpired || Boolean(state.result);
  resultButtons.forEach((button) => { button.disabled = noRound || state.gameOver || approximation || !state.released || Boolean(state.result); button.classList.toggle("is-selected", state.result === button.dataset.result); });
  if (approximationButton) approximationButton.disabled = noRound || state.gameOver || !approximation || !state.released || state.approximationCalculated || Boolean(state.result);
  [finalTeam, finalBid, confirmButton].forEach((element) => { if (element) element.disabled = noRound || state.gameOver || approximation || Boolean(state.result) || state.confirmed; });
  if (state.confirmed && !approximation) { finalTeam.value = state.team; finalBid.value = Number.isInteger(state.bid) ? state.bid : ""; }
  if (valueVisibility) valueVisibility.textContent = state.result ? "revelado ao final da rodada" : state.valueRevealed ? "revelado no Painel da disputa" : state.config.ocultarValor ? "oculto das equipes" : "anunciado às equipes";
  if (revealButton) { revealButton.hidden = !(question && state.config.ocultarValor && !state.result); revealButton.disabled = noRound || Boolean(state.result); revealButton.textContent = state.valueRevealed ? "Ocultar valor no Painel" : "Revelar valor no Painel"; }
  nextLotButton.hidden = !state.result || state.gameOver;
  if (startAnotherGameButton) startAnotherGameButton.hidden = !state.gameOver;
  if (approximationReleaseButton) approximationReleaseButton.hidden = !state.approximationCalculated || Boolean(state.result) || state.gameOver;
  if (endPanel) endPanel.hidden = state.gameOver;
  if (endGameButton) endGameButton.disabled = state.gameOver || (!state.result && !state.catalogExhausted);
  if (catalogLoadError) { status.textContent = "Catálogo indisponível"; message.textContent = "Não foi possível carregar as questões. Inicie pelo servidor local."; return; }
  if (noRound) { status.textContent = "Catálogo esgotado"; message.textContent = "Não há mais perguntas disponíveis. Adicione novas questões ao catálogo para continuar."; displays.forEach((element) => { element.textContent = formatTime(state.config.timerSeconds); }); return; }
  if (state.gameOver) { status.textContent = "Partida encerrada"; message.textContent = "Acompanhe o ranking final no Painel da disputa."; displays.forEach((element) => { element.textContent = formatTime(state.config.timerSeconds); }); return; }
  if (state.result) { status.textContent = "Rodada encerrada"; message.textContent = approximation ? "Resultado de aproximação registrado e saldos atualizados." : state.result === "correct" ? "Resultado: lote adquirido e saldo atualizado." : "Resultado: lance redistribuído e saldos atualizados."; }
  else if (state.approximationCalculated) { status.textContent = "Respostas calculadas"; message.textContent = "Respostas foram exibidas. Libere resposta correta e equipe vencedora."; }
  else if (!state.released) { status.textContent = "Privada — pronta para liberação"; message.textContent = approximation ? "Libere a rodada quando todas as equipes estiverem prontas para responder." : state.confirmed ? "Lance confirmado e saldo descontado. Libere a pergunta quando estiver pronto." : "Confirme o lance e libere a pergunta para iniciar o tempo."; }
  else if (state.timerExpired) { status.textContent = "Exibida no Painel da disputa"; message.textContent = approximation ? "Tempo encerrado. Registre respostas e calcule resultado." : "Tempo encerrado. Marque o resultado da resposta manualmente."; }
  else if (state.timerEndsAt) { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Tempo em andamento no Painel da disputa."; }
  else { status.textContent = "Exibida no Painel da disputa"; message.textContent = "Rodada liberada. Inicie o tempo quando as equipes estiverem prontas."; }
  const seconds = state.timerEndsAt ? remainingSeconds(state) : state.config.timerSeconds;
  displays.forEach((element) => { element.textContent = state.timerExpired ? "Tempo encerrado" : formatTime(seconds); });
}

function renderPublicApproximationAnswers(state) {
  const panel = document.querySelector("[data-public-approximation-answers]"); const list = document.querySelector("[data-public-approximation-answer-list]");
  if (!panel || !list) return;
  const answers = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
  list.replaceChildren(...state.teams.map((team) => {
    const item = document.createElement("li"); item.style.setProperty("--team-color", team.color);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"); name.textContent = team.name;
    const value = document.createElement("b"); value.textContent = formatApproximationValue(answers.get(team.name));
    item.append(dot, name, value); return item;
  }));
  panel.hidden = false;
}

function renderPublicResult(state) {
  const question = getQuestion(state); const title = document.querySelector("[data-public-result-title]"); const message = document.querySelector("[data-public-result-message]"); const recipients = document.querySelector("[data-public-recipients]"); const shareValue = document.querySelector("[data-public-share]"); const correctAnswer = document.querySelector("[data-public-correct-answer]");
  if (state.result === "approximation") {
    const winners = state.winningTeams.join(" e ");
    const share = Math.floor(question.valorLote / state.winningTeams.length);
    const answers = new Map(state.approximationAnswers.map((answer) => [answer.team, answer.value]));
    const winnerAnswers = state.winningTeams.map((team) => formatApproximationValue(answers.get(team))).join(" e ");
    title.textContent = `${winners} ${state.winningTeams.length === 1 ? "ficou mais próxima" : "ficaram mais próximas"}`;
    message.textContent = `${state.winningTeams.length === 1 ? "Resposta da equipe" : "Respostas das equipes"}: ${winnerAnswers}.`;
    recipients.hidden = false; recipients.querySelector("p").textContent = state.winningTeams.length === 1 ? "Valor recebido pela equipe:" : "Valor recebido por cada equipe empatada:"; shareValue.textContent = formatMoney(share);
    correctAnswer.textContent = `Resposta correta: ${question.resposta}`; correctAnswer.hidden = false;
    return;
  }
  if (state.result === "correct") { title.textContent = "Lote adquirido"; message.textContent = `${state.team} acertou a resposta e adquiriu o lote.`; recipients.hidden = false; recipients.querySelector("p").textContent = "Valor do lote:"; shareValue.textContent = formatMoney(question.valorLote); correctAnswer.hidden = true; return; }
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

function renderFinalRanking(state) {
  const list = document.querySelector("[data-final-list]");
  if (!list) return;
  list.replaceChildren(...state.standings.map((team, index) => {
    const item = document.createElement("li"); item.className = "final-rank-item"; item.style.setProperty("--team-color", team.color);
    const rank = document.createElement("span"); rank.className = "final-rank-position"; rank.textContent = String(index + 1);
    const dot = document.createElement("span"); dot.className = "team-dot"; dot.setAttribute("aria-hidden", "true");
    const name = document.createElement("strong"); name.textContent = team.name;
    const stats = document.createElement("span"); stats.className = "final-rank-stats";
    const lots = document.createElement("b"); lots.textContent = `${team.lots} ${team.lots === 1 ? "lote" : "lotes"}`;
    const detail = document.createElement("small"); detail.textContent = `saldo ${formatMoney(team.balance)}`;
    stats.append(lots, detail); item.append(rank, dot, name, stats); return item;
  }));
}

function renderPublicPanel() {
  const shell = document.querySelector(".public-shell"); if (!shell) return;
  const state = readRoundState(); const question = getQuestion(state); renderQuestion(state);
  const waiting = document.querySelector("[data-public-waiting]"); const startWaiting = document.querySelector("[data-public-start-waiting]"); const round = document.querySelector("[data-public-round]"); const result = document.querySelector("[data-public-result]"); const final = document.querySelector("[data-final-ranking]"); const teaser = document.querySelector("[data-public-teaser]"); const approximationAnswers = document.querySelector("[data-public-approximation-answers]");
  const gameOver = Boolean(state.gameOver);
  if (final) final.hidden = !gameOver;
  if (gameOver) { if (startWaiting) startWaiting.hidden = true; waiting.hidden = true; round.hidden = true; result.hidden = true; if (approximationAnswers) approximationAnswers.hidden = true; shell.dataset.publicState = "final"; renderFinalRanking(state); return; }
  if (state.awaitingSetup) { if (startWaiting) startWaiting.hidden = false; waiting.hidden = true; round.hidden = true; result.hidden = true; if (final) final.hidden = true; if (teaser) teaser.hidden = true; if (approximationAnswers) approximationAnswers.hidden = true; shell.dataset.publicState = "setup"; return; }
  if (startWaiting) startWaiting.hidden = true;
  if (teaser) teaser.hidden = !question;
  waiting.hidden = state.released || Boolean(state.result); round.hidden = !state.released || Boolean(state.result) || !question; result.hidden = !state.result; shell.dataset.publicState = state.result ? "result" : state.released ? "released" : "waiting";
  round.classList.toggle("is-answers-only", Boolean(state.approximationCalculated && !state.result));
  if (state.result) { renderPublicResult(state); return; }
  if (approximationAnswers) approximationAnswers.hidden = true;
  if (!state.released) { renderPublicRanking(state); return; }
  renderPublicRoundContext(state, question);
  if (state.approximationCalculated) renderPublicApproximationAnswers(state);
  const timer = document.querySelector("[data-public-timer]"); const note = document.querySelector("[data-public-timer-note]");
  if (state.timerExpired) { timer.textContent = "Tempo encerrado"; timer.classList.add("is-ended"); note.textContent = "Aguardando a decisão do leiloeiro."; }
  else if (state.timerEndsAt) { timer.textContent = formatTime(remainingSeconds(state)); timer.classList.remove("is-ended"); note.textContent = "Tempo de resposta em andamento."; }
  else { timer.textContent = formatTime(state.config.timerSeconds); timer.classList.remove("is-ended"); note.textContent = "Aguardando o início do tempo."; }
}

function settleExpiredTimer() { const state = readRoundState(); if (state.timerEndsAt && remainingSeconds(state) === 0) saveRoundState({ timerEndsAt: null, timerExpired: true }); }
function applyResult(result) {
  const state = readRoundState(); const question = getQuestion(state); if (state.result || !state.confirmed || !question || !isAuctionQuestion(question)) return;
  const share = Math.floor(state.bid / (state.teams.length - 1));
  const teams = state.teams.map((team) => {
    if (team.name !== state.team) return result === "wrong" ? { ...team, balance: team.balance + share } : team;
    const debitedBalance = state.bidDebited ? team.balance : team.balance - state.bid;
    return result === "correct" ? { ...team, balance: debitedBalance + question.valorLote, lots: team.lots + 1 } : { ...team, balance: debitedBalance };
  });
  saveRoundState({ teams, bidDebited: true, result, timerEndsAt: null, timerExpired: true });
}

function getApproximationTarget(answer) {
  const match = String(answer || "").match(/-?\d+(?:[.,]\d+)?/);
  return match ? Number(match[0].replace(",", ".")) : NaN;
}

function calculateApproximation() {
  const state = readRoundState(); const question = getQuestion(state); const approximationAnswers = [...document.querySelectorAll("[data-approximation-team]")].map((input) => ({ team: input.dataset.approximationTeam, value: input.value.trim() })); const target = getApproximationTarget(question?.resposta);
  if (!isApproximation(question) || state.result || state.approximationCalculated || !state.released || !Number.isFinite(target) || approximationAnswers.some((answer) => answer.value === "" || !Number.isFinite(Number(answer.value)))) return;
  const distances = approximationAnswers.map((answer) => ({ team: answer.team, distance: Math.abs(Number(answer.value) - target) }));
  const smallestDistance = Math.min(...distances.map((answer) => answer.distance));
  const selected = distances.filter((answer) => Math.abs(answer.distance - smallestDistance) < 1e-9).map((answer) => answer.team);
  saveRoundState({ winningTeams: selected, approximationAnswers, approximationCalculated: true, timerEndsAt: null, timerExpired: true });
}

function applyApproximationResult() {
  const state = readRoundState(); const question = getQuestion(state); const selected = state.winningTeams;
  if (!isApproximation(question) || state.result || !state.approximationCalculated || !selected.length) return;
  const share = Math.floor(question.valorLote / selected.length);
  const teams = state.teams.map((team) => selected.includes(team.name) ? { ...team, balance: team.balance + share, lots: team.lots + 1 } : team);
  saveRoundState({ teams, result: "approximation", timerEndsAt: null, timerExpired: true });
}

function computeFinalStandings(state) {
  return state.teams.map((team) => ({ name: team.name, color: team.color, balance: team.balance, lots: team.lots }))
    .sort((a, b) => b.lots - a.lots || b.balance - a.balance);
}

function startSelectedLot(filter) {
  const state = readRoundState();
  saveRoundState({ team: "", bid: null, bidDebited: false, confirmed: false, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationCalculated: false, valueRevealed: false, ...chooseNextQuestion(state, filter) });
  const finalTeam = document.querySelector("#final-team"); const finalBid = document.querySelector("#final-bid"); const chooser = document.querySelector("[data-next-lot-chooser]");
  if (finalTeam) finalTeam.value = ""; if (finalBid) finalBid.value = ""; if (chooser) chooser.hidden = true; pendingLotFilter = null;
  renderAuctioneer();
}

function endGame() {
  const state = readRoundState();
  if (!state.result && !state.catalogExhausted) return;
  if (!window.confirm("Encerrar a partida e exibir o ranking final?")) return;
  saveRoundState({ gameOver: true, standings: computeFinalStandings(state) });
  const chooser = document.querySelector("[data-next-lot-chooser]"); if (chooser) chooser.hidden = true;
  renderAuctioneer();
}

function startNewGame(teams, config) {
  const base = { ...initialRoundState, teams, usedQuestionIds: [], config: normaliseConfig(config) };
  localStorage.setItem(roundStorageKey, JSON.stringify(normaliseState({ ...base, ...chooseNextQuestion(base) })));
}

function prepareAnotherGame() {
  localStorage.setItem(roundStorageKey, JSON.stringify(normaliseState({ ...initialRoundState, awaitingSetup: true })));
  window.location.href = "leiloeiro.html";
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
  const ocultarValor = document.querySelector("#config-ocultar-valor"); const capLance = document.querySelector("#config-cap-lance"); const timerSeconds = document.querySelector("#config-timer-seconds");
  if (ocultarValor) ocultarValor.checked = state.config.ocultarValor;
  if (capLance) capLance.value = state.config.capLance;
  if (timerSeconds) timerSeconds.value = state.config.timerSeconds;
  startButton.addEventListener("click", () => {
    const teams = [0, 1, 2, 3].map((index) => ({ name: document.querySelector(`#team-${index + 1}`).value.trim(), color: document.querySelector(`#color-${index + 1}`).value, balance: 1000, lots: 0 }));
    const names = teams.map((team) => team.name.toLocaleLowerCase("pt-BR")); const message = document.querySelector("#setup-message");
    if (catalogLoadError || !questions().length) { message.textContent = "Não foi possível carregar o catálogo de questões. Inicie o servidor local e tente novamente."; return; }
    if (teams.some((team) => !team.name) || new Set(names).size !== teams.length) { message.textContent = "Informe quatro nomes diferentes para iniciar a partida."; return; }
    const config = { ocultarValor: ocultarValor ? ocultarValor.checked : true, capLance: capLance ? capLance.value : 50, timerSeconds: timerSeconds ? timerSeconds.value : 45 };
    startNewGame(teams, config); window.location.href = "partida.html";
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadQuestionCatalog();
  initialiseSetup();
  const confirmButton = document.querySelector("#confirm-final-bid");
  if (confirmButton) {
    confirmButton.addEventListener("click", () => { const state = readRoundState(); if (state.confirmed) return; const team = document.querySelector("#final-team").value; const bidInput = document.querySelector("#final-bid"); const bid = Number(bidInput.value); if (!team || !Number.isInteger(bid) || bid < 0) { bidInput.setCustomValidity("Informe um lance inteiro em reais."); bidInput.reportValidity(); return; } const biddingTeam = state.teams.find((entry) => entry.name === team); const balance = Math.floor(Number(biddingTeam?.balance) || 0); const cap = state.config.capLance; const maxBid = cap > 0 ? Math.floor(balance * cap / 100) : balance; if (bid > maxBid) { const limitText = cap > 0 ? `Teto de lance: ${cap}% do saldo (máximo ${formatMoney(maxBid)}).` : `Saldo disponível: ${formatMoney(maxBid)}.`; bidInput.setCustomValidity(limitText); bidInput.reportValidity(); return; } bidInput.setCustomValidity(""); const teams = state.teams.map((entry) => entry.name === team ? { ...entry, balance: entry.balance - bid } : entry); saveRoundState({ teams, team, bid, bidDebited: true, confirmed: true, released: false, timerEndsAt: null, timerExpired: false, result: null, winningTeams: [], approximationAnswers: [], approximationCalculated: false, valueRevealed: false }); renderAuctioneer(); });
    document.querySelector("#release-question").addEventListener("click", () => { saveRoundState({ released: true }); renderAuctioneer(); });
    document.querySelector("#start-timer").addEventListener("click", () => { const state = readRoundState(); saveRoundState({ timerEndsAt: Date.now() + (state.config.timerSeconds * 1000), timerExpired: false }); renderAuctioneer(); });
    document.querySelectorAll("[data-result]").forEach((button) => button.addEventListener("click", () => { applyResult(button.dataset.result); renderAuctioneer(); }));
    document.querySelector("#confirm-approximation").addEventListener("click", () => { const answers = [...document.querySelectorAll("[data-approximation-team]")]; const missing = answers.find((input) => input.value.trim() === "" || !Number.isFinite(Number(input.value))); if (missing) { missing.setCustomValidity("Registre valor de resposta desta equipe."); missing.reportValidity(); return; } answers.forEach((input) => input.setCustomValidity("")); calculateApproximation(); renderAuctioneer(); });
    const revealButton = document.querySelector("#reveal-value");
    if (revealButton) revealButton.addEventListener("click", () => { const state = readRoundState(); saveRoundState({ valueRevealed: !state.valueRevealed }); renderAuctioneer(); });
    const approximationReleaseButton = document.querySelector("#release-approximation-result");
    if (approximationReleaseButton) approximationReleaseButton.addEventListener("click", () => { applyApproximationResult(); renderAuctioneer(); });
    const startAnotherGameButton = document.querySelector("#start-another-game");
    if (startAnotherGameButton) startAnotherGameButton.addEventListener("click", () => prepareAnotherGame());
    document.querySelector("#prepare-next-lot").addEventListener("click", () => {
      const state = readRoundState(); const chooser = document.querySelector("[data-next-lot-chooser]");
      const remaining = questions().filter((question) => !state.usedQuestionIds.includes(question.id));
      if (!remaining.length) { endGame(); return; }
      chooser.hidden = false; renderNextLotChooser(state);
    });
    const confirmNextLot = document.querySelector("#confirm-next-lot");
    if (confirmNextLot) confirmNextLot.addEventListener("click", () => { if (!pendingLotFilter) return; startSelectedLot(pendingLotFilter); });
    const cancelChooser = document.querySelector("#cancel-chooser");
    if (cancelChooser) cancelChooser.addEventListener("click", () => { const chooser = document.querySelector("[data-next-lot-chooser]"); if (chooser) chooser.hidden = true; });
    const endGameButton = document.querySelector("#end-game");
    if (endGameButton) endGameButton.addEventListener("click", () => endGame());
  }
  window.addEventListener("storage", () => { renderAuctioneer(); renderPublicPanel(); });
  setInterval(() => { settleExpiredTimer(); const editing = document.activeElement?.matches("#final-bid, #final-team, [data-approximation-team]"); if (!editing) renderAuctioneer(); renderPublicPanel(); }, 250);
  renderAuctioneer(); renderPublicPanel();
});
