# Leilão do Censo — contexto atual para o próximo chat

Atualizado em 14/09/2026. Este arquivo descreve a versão atual do projeto e prevalece sobre anotações antigas de planejamento, snapshots anteriores e menções a 12 questões.

## Produto e uso

Jogo escolar presencial de Geografia sobre demografia. Há dois painéis no mesmo servidor local:

- **Painel do leiloeiro**: configura equipes, conduz a rodada, conhece a resposta de referência, registra lance ou apostas e decide resultados.
- **Painel da disputa**: visão pública para projetor 16:10, sem rolagem vertical, com equipes, saldos, lotes, questão liberada e resultado.

Identidade aprovada: fundo claro quente, títulos em índigo/teal, acentos coral e lima, com linhas demográficas sutis. Não transformar em estética escura, vintage ou de “tela do projetor”.

## Arquitetura e execução

- HTML, CSS e JavaScript puros; sem framework ou dependências de front-end.
- Servidor Node nativo em `server.js`.
- Executar com `node server.js`; endereço padrão: `http://127.0.0.1:4173/`.
- Páginas: `index.html`, `leiloeiro.html`, `partida.html` e `disputa.html`.
- Catálogo Markdown em `content/perguntas/`.
- Estado local do navegador: chave `leilao-do-censo-round`.
- Sincronização local: `GET/PUT /api/state` e SSE em `/api/state/events`. O estado compartilhado está apenas em memória e é perdido ao reiniciar o servidor.
- O painel público possui transições discretas entre espera, pergunta, respostas de aproximação, resultado e final. Elas usam opacidade e leve deslocamento; respeitam `prefers-reduced-motion`.

## Catálogo atual

Há 24 questões válidas, carregadas pelo servidor:

| IDs | Modalidade | Valor de lote |
|---|---|---|
| 01, 02, 03 | Múltipla escolha | R$ 300, R$ 400 e R$ 350 |
| 04, 05, 06 | Aproximação | Não há valor de lote |
| 07, 08 | Resposta aberta | R$ 400 e R$ 500 |
| 09, 10 | Verdadeiro/falso | R$ 450 cada |
| 11, 12, 13, 14 | Múltipla escolha | R$ 350, R$ 400, R$ 450 e R$ 400 |
| 15, 16, 17, 18 | Resposta aberta | R$ 500, R$ 450, R$ 450 e R$ 600 |
| 19, 20, 21 | Aproximação | Não há valor de lote |
| 22, 23, 24 | Verdadeiro/falso | R$ 450, R$ 350 e R$ 400 |

Campos aceitos: `id`, `modalidade`, `enunciado`, `alternativas` quando aplicável, `resposta` e `valor_lote` exceto em aproximação. Não usar tópico ou dificuldade.

- Verdadeiro/falso mostra somente “Verdadeiro” e “Falso”, sem A)/B).
- Aproximação usa a primeira quantidade numérica presente em `resposta` como referência de cálculo; as três questões atuais seguem esse formato.

## Regras implementadas

### Configuração e rodada normal

1. O leiloeiro define quatro nomes distintos, cores, ocultação do valor, teto percentual de lance e tempo.
2. Iniciar partida restaura R$ 1.000 e zero lotes para cada equipe, limpa questões usadas e sorteia o primeiro lote.
3. Em questão normal, o leiloeiro registra uma equipe e um lance inteiro.
4. O lance é descontado imediatamente. O teto é percentual do saldo; teto 0 significa saldo total disponível.
5. Após liberação, o painel público recebe questão, equipe e lance final; a pergunta só aparece depois da confirmação do lance.
6. Acerto: a equipe recebe 1 lote e o valor-base da questão.
7. Erro: o lance permanece perdido; cada uma das outras três equipes recebe `floor(lance / 3)` e o resto é descartado.

### Aproximação

1. Não há valor de lote nem lance vencedor.
2. Cada equipe registra uma resposta numérica e uma aposta inteira entre R$ 0 e seu saldo.
3. O sistema calcula a menor distância absoluta até a resposta de referência e aceita empate.
4. Todas as apostas são descontadas; o pote é dividido com `floor(pote / quantidade de vencedoras)` e o resto é descartado.
5. Cada equipe mais próxima recebe também 1 lote.
6. Depois do cálculo, o painel público mostra respostas e apostas, mas não a referência. O leiloeiro libera separadamente a resposta correta e as vencedoras.

### Próxima rodada e fim

- `Preparar próximo lote` exige selecionar e confirmar Aleatório, Múltipla escolha, Resposta aberta, Aproximação ou Verdadeiro/falso.
- Perguntas usadas não são sorteadas de novo. O placar acumulado é preservado.
- `Encerrar partida` fica na lateral e pede confirmação.
- O ranking final ordena por lotes decrescentes e, em empate, saldo decrescente.
- `Começar outra partida` volta ao formulário; o painel público fica em espera sem equipes.
- O antigo desempate por pergunta extra e a tela de vencedora antes de liberar ranking **não estão implementados**.

## Regras visuais que devem ser preservadas

- A tela pública precisa caber inteira em projetor 16:10, sem scroll vertical. Mobile é prioridade somente para o Painel do leiloeiro.
- Saldos e lotes são públicos durante espera e ranking.
- Modalidade e resposta de referência não devem ser mostradas pela interface pública antes do resultado adequado.
- Valores monetários usam `.money-value`, `.money-currency` e `.money-amount`; o `R$` deve permanecer próximo do número, em posição estável.
- No ranking final, lote e saldo são colunas fixas separadas.
- “Lote não adquirido” mantém `R$` junto do valor distribuído.
- No leiloeiro, respostas e apostas de aproximação são uma lista vertical: equipe, resposta e aposta.

## Auditoria funcional de 14/09/2026

Auditada sem modificar código, catálogo, configurações ou estado permanente. Foi usada uma instância temporária do servidor na porta 4182, encerrada no final.

Passaram:

- leitura das 10 questões existentes à época e validação de seus campos;
- múltipla escolha: acerto e erro com desconto, divisão inteira e descarte do resto;
- resposta aberta sem alternativas no painel público;
- verdadeiro/falso sem letras A)/B);
- aproximação com vencedora única, empate, aposta zero, divisão do pote e descarte do resto;
- bloqueio de lance acima do teto e aposta acima do saldo;
- cronômetro curto até “Tempo encerrado”;
- limpeza dos campos de aproximação ao mudar para outra questão;
- preparação confirmada do próximo lote sem repetir questão e preservando saldos/lotes;
- sincronização visual entre painel privado e público;
- ausência visual de resposta de referência antes da etapa de revelação.

Exemplos validados:

- Lance errado de R$ 301: equipe fica com R$ 699; as outras três recebem R$ 100 cada; R$ 1 é descartado.
- Aproximação com apostas R$ 100/R$ 200/R$ 300/R$ 400: vencedora única recebe R$ 1.000 e 1 lote.
- Empate com pote R$ 401: duas vencedoras recebem R$ 200 cada e R$ 1 é descartado.

Não foi concluída por automação a confirmação nativa do navegador ao encerrar a partida. A regra de ordenação foi inspecionada no código, mas o fechamento completo e “Começar outra partida” devem receber uma verificação manual curta se forem alterados no futuro.

## Privacidade: decisão atual

O endpoint `/api/questions` entrega respostas, modalidades e valores de lote para qualquer navegador antes da liberação. Portanto, a privacidade é somente visual; alguém com inspeção técnica poderia consultar as respostas.

Isso **não vaza pela interface normal** e não afeta o funcionamento da partida. Como é um trabalho escolar de uso único, foi decidido não alterar agora a arquitetura para separar catálogo público e privado. Não prometer privacidade de servidor se esse ponto voltar a ser discutido.

## Ampliação do catálogo em 14/09/2026

As 14 questões extraídas de `questoes2.txt` foram normalizadas no formato de front matter e adicionadas com IDs de 11 a 24. O catálogo deve ser conferido pelo endpoint real antes de novos commits.

O arquivo `questoes2.txt` foi preservado como material-fonte local e não é necessário para o jogo carregar as novas perguntas.

## Estado do repositório e cuidados

- HEAD registrado anteriormente: `e9cf2d7 feat(game): add configurable round flow`.
- Há alterações não commitadas em arquivos de jogo e no catálogo. Elas são parte da versão atual e devem ser preservadas.
- Arquivos não rastreados que não devem ser alterados nem incluídos em commit sem pedido explícito: `.agents/`, `.codex/`, `.impeccable/`, `atual.zip` e `skills-lock.json`.
- O nome físico da pasta continua `Leilão do Senso`; o nome do produto é **Leilão do Censo**. Não renomear a pasta sem confirmação.

## Como continuar no próximo chat

1. Ler este arquivo e executar `git status --short` antes de editar.
2. Preservar alterações existentes e não fazer commit sem pedido explícito.
3. Rodar `node --check app.js`, `node --check server.js` e testar o fluxo real correspondente a qualquer mudança.
4. Se mudar servidor ou sincronização, reiniciar `node server.js` antes do teste.
5. Não ampliar escopo para resolver a privacidade técnica, salvo se o usuário pedir explicitamente.
