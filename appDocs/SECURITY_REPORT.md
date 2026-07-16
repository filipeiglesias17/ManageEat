# Relatório de Segurança e Guia de Pentest - Manage Eat

Data: 2026-04-12

---

> ## 🔄 Atualização (2026-06-20) — Saída da Firebase para Supabase local
>
> **A app deixou de usar a Firebase.** O backend passou a ser **Supabase local** (Docker): Postgres +
> Auth + Realtime. Consequências de segurança:
> - **A fronteira mudou de `firestore.rules` para RLS + triggers (Postgres)**, em `supabase/migrations/`.
>   A RLS está validada por `supabase/audit.ts`; os ficheiros Firebase foram removidos do runtime.
> - **Hardening QR:** `sessions` já não tem SELECT público direto. A rota pública usa
>   `get_public_session`, que não devolve `accessCodeHash`; a prova/criação do código passa por
>   `claim_session_with_code` e regista `session_clients`. Tentativas erradas ficam em
>   `session_code_attempts`: 5 erros bloqueiam 5 minutos e staff operacional pode resetar o código.
>   `orders` QR exigem esse vínculo; `service_calls` permite só "chamar empregado" antes do código.
> - **Hardening de dinheiro e timestamps:** `orders_validate_insert` recalcula cada linha contra
>   `menu_items` antes de gravar: preço, nome, IVA, item indisponível, quantidade máxima 99,
>   ingredientes removidos e descontos de staff até 100%. O `created_at` oficial do pedido vem da BD.
>   Em `service_calls`, a chamada nasce `open` com timestamp da BD e só empregado/gerente/admin podem
>   assumir/resolver; cozinha lê, mas não trata chamadas.
> - **Vantagem nova:** com Postgres, várias mitigações que antes exigiam **Blaze/Cloud Functions** (ex.:
>   verificar o código de acesso no servidor, timestamps do servidor, recálculo de preços) passam a ser
>   possíveis com **triggers/RPC locais** — sem custo. A verificação do código QR já foi movida para RPC;
>   recálculo de preços e timestamps críticos já vivem em triggers.
> - **App Check / reCAPTCHA desapareceu** (era Firebase). Rate-limiting passaria a ser via Supabase (não
>   configurado em local).
> - **Credenciais:** o `.env.local` deixa de ter `VITE_FIREBASE_*` e passa a ter `VITE_SUPABASE_URL` /
>   `VITE_SUPABASE_ANON_KEY` (browser) e `SUPABASE_SERVICE_ROLE_KEY` (só terminal: seed). **Nunca** pôr a
>   service_role no frontend.

---

> ## 🔄 Atualização (2026-06-20)
>
> **Conta cliente amarrada à mesa (fecha parte do #4).** A conta `cliente` (login) é um tablet fixo
> numa mesa do restaurante. Deixou de escrever o nº da mesa à mão: a mesa vive agora no profile
> (`profiles/{uid}.tableNumber`, definida pelo admin) e as `firestore.rules` exigem, em `orders.create`,
> que o pedido de um cliente seja para a mesa do seu profile (`clienteOrderTableMatchesProfile`). Mesa
> obrigatória — um cliente sem mesa atribuída não cria pedidos. Empregado/admin continuam livres; o QR
> anónimo continua validado por `tableMatchesSession`.
>
> **Escrita de menu/categorias validada.** Eram a única coleção com `write: if isAdmin()` sem validar a
> forma; como a leitura é pública, dados malformados chegavam a todos os clientes. Agora `validMenuItem()`
> /`validCategory()` validam chaves e tipos (defesa em profundidade).
>
> **Limites conhecidos no plano Spark (aceites, não regressões):**
>
> _Nota (2026-06-20): este bloco é **pré-migração**. Com a passagem para Supabase, o `accessCodeHash`
> deixou de ser comparado no browser (`claim_session_with_code`) e a integridade do pedido passou a ser
> validada no Postgres (`orders_validate_insert`) — os dois primeiros pontos abaixo estão **resolvidos**.
> Ver o bloco no topo do relatório._
> - **`accessCodeHash` legível** — `sessions` tem `get: if true` (o QR precisa de ler a sessão) e as rules
>   não escondem campos individuais; quem tiver o link da sessão lê o hash do código de 4 dígitos e faz
>   brute-force offline trivial. É deterrência ao nível da app, não criptografia. Fix real = verificar o
>   código numa Cloud Function (**Blaze**), deixando de guardar o hash no doc público.
> - **`createdAt` vem do cliente** (string) — pode ser forjado para reordenar a fila FIFO da cozinha ou
>   cair fora da janela `ORDERS_LIMIT`. Fix = timestamps do servidor (refactor maior).
> - **Sem rate-limit nos writes** — uma sessão QR válida pode fazer spam de pedidos/chamadas. As rules não
>   fazem throttling; o único travão é o **App Check** (código pronto em `firebase.ts`), não ativo em localhost.
> - **#7 (seed partilhado)** — aceite em localhost: as credenciais do seed (`manageeat2026!`) são **dev-only**
>   e servem o `gate:rules`. **Trocar antes de qualquer deploy.**

---

> ## 🔄 Atualização (2026-06-18)
>
> O rodízio voltou como feature faturável e ganhou nova mitigação Spark:
> `sessions.create` só aceita snapshot de rodízio quando `settings/restaurant` está em `rodizio` ou
> `mixed`, e o `entryPrice` da sessão é igual ao setting atual. Isto reduz o risco de um empregado abrir
> rodízio com entrada adulterada via DevTools.
>
> Pedidos cancelados deixaram de ser apagados pela cozinha. Cancelar agora é update lógico com
> `status: cancelled`, `cancelledAt`, `cancelledBy` e `cancelReason`; delete físico fica só para admin.
>
> O risco #9 continua aberto no essencial: os preços por linha ainda vêm do browser no plano Spark.
> A mitigação nova é revalidar o carrinho contra o menu vivo antes do submit e excluir cancelados dos
> totais/estatísticas via `lib/account.ts`.

---

> ## 🔄 Atualização (2026-06-16)
>
> Âmbito atual: a app corre **apenas em localhost** (sem deploy/hosting) e mantém-se no **plano grátis
> (Spark)**. Isto muda a leitura de alguns findings:
>
> - **#4 (`orders` create)** — já **não** é `allow if true`: as `firestore.rules` exigem `signedIn()`,
>   validam a estrutura do pedido (chaves, `status=pending`, `source`, `tableNumber≥1`, tamanho de
>   `items`, mesa = sessão no fluxo QR) e bloqueiam edição de items depois de criado. Passa a 🟡
>   **Parcial** — falta só o recálculo de preços no servidor (= #9).
> - **#9 (integridade do pedido)** — continua **aberto** e é uma **limitação do plano grátis**: as
>   rules não conseguem iterar `items[]`, e o recálculo exigiria Cloud Functions (Blaze). Mitigação
>   client-side em `src/lib/order-utils.ts` (nunca mostra NaN/negativos). Aceite como risco conhecido.
> - **#10 (App Check)** — o código já está pronto em `firebase.ts` (liga-se com uma reCAPTCHA key e
>   desliga-se sozinho sem ela). Não ativado em localhost.
> - **#11 (headers)** — **N/A**: sem produção, só o dev server. Não se configurou hosting.
> - **Sessão expulsa em tempo real** — o `AuthProvider` agora subscreve o próprio profile e faz
>   `signOut` imediato quando o admin desativa a conta (antes só no refresh seguinte).
>
> Nota histórica: o modo rodízio visual foi removido em 2026-06-16, mas voltou em 2026-06-17 como
> rodízio com entrada por pessoa e snapshots de sessão.

---

> ## ⚠️ Estado atual (atualizado em 2026-06-02)
>
> Este relatório foi escrito **antes da PHASE1** e descreve o modelo de segurança antigo (auth no
> browser, sessão em `localStorage`, coleção `users` com hashes bcrypt). A **PHASE1 já foi
> implementada** (Firebase Auth + `profiles/{uid}` + regras baseadas em `request.auth`), por isso
> vários findings já não se aplicam. Os findings ficam como **registo histórico do pentest**; a
> tabela abaixo mapeia cada um ao estado atual.
>
> | # | Finding | Sev. orig. | Estado |
> |---|---------|-----------|--------|
> | 1 | Leitura pública de `users` (hashes/roles) | Crítico | ✅ **Resolvido** — `users` bloqueado; `profiles` nunca contém password |
> | 2 | Autenticação feita no cliente | Crítico | ✅ **Resolvido** — Supabase Auth (era Firebase Auth) |
> | 3 | Autorização forjável via storage local | Crítico | ✅ **Resolvido** — role vem de `profiles` (id=`auth.uid()`) + RLS |
> | 4 | `orders` create público sem validação | Crítico | ✅ **Resolvido** — RLS `orders_insert` + trigger `orders_validate_insert` (snapshot recalculado no Postgres) |
> | 5 | `sessions` read/create/delete público | Crítico | ✅ **Resolvido** — `sessions` sem SELECT público; QR lê por `get_public_session` (RPC), que não expõe `accessCodeHash` |
> | 6 | Sessão QR revogada continua útil | Alto | ✅ **Resolvido** — revalidação antes de submeter (`cliente-session.tsx`) |
> | 7 | Seed previsível + política de passwords fraca | Alto | 🟡 **Parcial** — mínimo subiu para 12 chars; o seed ainda usa uma password partilhada (dev-only, localhost) |
> | 8 | Sem rate limiting / anti brute-force | Alto | ✅ **Resolvido** — bloqueio do código QR (`session_code_attempts`: 5 erros → 5 min) + rate-limit dos writes (triggers `orders_rate_limit`/`service_calls_rate_limit`: 10 pedidos / 5 chamadas por sessão anónima em 30s) |
> | 9 | Integridade do pedido depende do cliente | Médio | ✅ **Resolvido** — `orders_validate_insert` recalcula preço/IVA/desconto/ingredientes no Postgres |
> | 10 | Sem App Check | Médio | ⬜ **N/A** — App Check era Firebase; em Supabase local não se aplica |
> | 11 | Sem headers de hardening | Médio | 🟡 **Parcial** — CSP/nosniff/frame/referrer no dev server (`vite.config.ts`); produção N/A (localhost-only) |
> | 12 | Sem `.gitignore` | Médio | ✅ **Resolvido** — `.gitignore` adicionado |
>
> **Estado pós-migração (2026-06-20):** os riscos críticos #4 e #9 estão **resolvidos** pela RLS +
> trigger `orders_validate_insert`, #5 por `get_public_session`, e #8 pelos triggers de rate-limit
> (`orders_rate_limit`/`service_calls_rate_limit`). Restam itens menores e aceites em localhost: o seed
> usa uma password partilhada dev-only (#7) e CSP de produção é N/A sem deploy (#11). As referências de
> linha nos findings abaixo apontam para o código **antigo** (Firebase) e podem já não corresponder.

---

## Objetivo

Este documento tem 2 objetivos:

1. Relatar as falhas de segurança identificadas na app, com detalhe suficiente para reproduzir os testes em contexto de pentest desta aplicação.
2. Propor a solução técnica que eu implementaria para eliminar ou reduzir essas falhas.

## Âmbito da análise

Código revisto:

- `src/`
- `firebase/firestore.rules`
- `firebase/seed.ts`
- `index.html`
- `package.json`
- `package-lock.json`
- configuração local do projeto

Técnicas usadas:

- revisão estática de código
- revisão de regras do Firestore
- revisão do fluxo de autenticação e autorização
- revisão da superfície pública exposta pela SPA
- pesquisa local de sinks de XSS
- verificação de CVEs com `npm audit --json`

## Resultado executivo

> **Nota histórica:** esta secção descreve a app **como estava a 2026-04-12** (versão
> Firebase, pré-PHASE1) e é mantida como registo do pentest original. O estado atual —
> com os críticos resolvidos após a migração para Supabase (RLS + triggers) — está nos
> blocos de atualização e na tabela de findings no topo deste documento.

O modelo de segurança **à data da análise original** estava comprometido na base:

- a autenticação é feita no cliente
- a autorização é feita no cliente
- o Firestore expõe dados e operações críticas publicamente

Isto significa que um atacante não precisa de explorar vulnerabilidades sofisticadas. Em vários casos basta:

- manipular `localStorage`
- chamar a app diretamente
- usar o SDK/REST do Firestore contra coleções públicas

Conclusão:

- a app não está apta para produção
- o risco principal é `compromisso lógico/arquitetural`, não uma falha isolada de frontend

## Estado de CVEs nas dependências

### Verificação executada

Comando executado:

```bash
npm audit --json
```

Resultado à data desta análise:

```json
{
  "metadata": {
    "vulnerabilities": {
      "info": 0,
      "low": 0,
      "moderate": 0,
      "high": 0,
      "critical": 0,
      "total": 0
    }
  }
}
```

### Interpretação

Não foram identificadas CVEs conhecidas nas dependências instaladas através do `npm audit` no momento da análise.

Isto **não** significa que a app esteja segura. Significa apenas que:

- a árvore de dependências atual não tem advisories conhecidas reportadas pelo `npm audit`
- o risco principal desta app está no desenho da autenticação, autorização e regras de acesso aos dados

### Recomendação para CVE hygiene

- correr `npm audit` em CI
- bloquear merge/deploy quando houver advisories `high` ou `critical`
- manter `react`, `vite`, `firebase` e `lucide-react` atualizados
- complementar `npm audit` com scans de SCA no pipeline

## Inventário resumido de superfícies de ataque

### Superfície autenticada por UI

- `/admin`
- `/empregado`
- `/cliente`
- `/cozinha`

### Superfície pública

- `/`
- `/mesa/:sessionId`
- Firestore `categories`
- Firestore `menuItems`
- Firestore `orders` para `create`
- Firestore `sessions` para `read/create/delete`
- Firestore `users` para `read`

### Armazenamento local

- `localStorage`
- `sessionStorage`

### Infra/configuração

- Firebase config exposta no frontend
- regras do Firestore
- script de seed

## Findings

## 1. Leitura pública da coleção `users` expõe hashes de password, usernames e roles

Severidade: Crítico

Referências:

- `firebase/firestore.rules:27-31`
- `src/lib/db.ts:116-125`
- `src/pages/login.tsx:41-49`

### O que está errado

As regras permitem leitura pública da coleção `users`:

```txt
match /users/{id} {
  allow read: if true;
  allow write: if false;
}
```

O login depende disso para obter o documento do utilizador e comparar o hash no browser.

### Impacto

- enumeração total de contas
- descoberta dos roles internos
- recolha de hashes bcrypt
- cracking offline de passwords
- preparação de ataques contra contas privilegiadas

### Como testar em pentest

Pré-condição:

- acesso ao projeto Firebase usado pela app
- valores `VITE_FIREBASE_*` presentes na app

Teste 1: enumeração lógica via fluxo da app

1. Abrir a app.
2. Tentar usernames prováveis no login.
3. Observar diferenças de tempo e comportamento entre utilizadores inexistentes e existentes.

Teste 2: leitura direta da coleção `users`

1. Usar um cliente que fale com Firestore usando a config da app.
2. Fazer leitura da coleção `users`.
3. Confirmar que o retorno inclui:
   - `username`
   - `role`
   - `password` com hash bcrypt

Teste 3: confirmar que o hash chega ao browser pelo fluxo normal

1. Abrir DevTools.
2. Fazer login com um username válido.
3. Inspecionar os pedidos ou colocar breakpoint no `handleSubmit`.
4. Confirmar que o objeto `user` inclui o campo `password` com hash.

### Como o ataque é executado

O ataque não precisa de bypass criptográfico. O fluxo é:

1. obter os documentos `users`
2. extrair os hashes bcrypt
3. correr cracking offline com uma wordlist controlada
4. usar a password descoberta no login

### Solução que eu implementaria

- remover leitura pública da coleção `users`
- deixar de guardar passwords nesta coleção para autenticação web
- migrar para `Firebase Auth`
- guardar apenas perfil/role num documento separado, acessível apenas com `request.auth != null`
- nunca enviar hashes ao frontend

## 2. Autenticação feita no cliente torna o login intrinsecamente inseguro

Severidade: Crítico

Referências:

- `src/pages/login.tsx:30-52`
- `src/lib/db.ts:121-125`

### O que está errado

O login é validado dentro do browser:

1. o cliente procura o utilizador
2. recebe o hash
3. faz `bcrypt.compare()`
4. gera uma pseudo-sessão local

Isto elimina qualquer fronteira de confiança.

### Impacto

- não existe controlo real de sessão
- não existe revogação central
- não existe rate limiting
- não existe MFA
- toda a confiança é delegada ao dispositivo do atacante

### Como testar em pentest

Teste 1: confirmar ausência de backend de autenticação

1. Rever `src/pages/login.tsx`.
2. Confirmar que não existe chamada para endpoint de auth confiável.
3. Confirmar que toda a validação é local.

Teste 2: confirmar que o login continua a funcionar apenas com dados do Firestore

1. Desligar qualquer backend extra.
2. Fazer login.
3. Verificar que o fluxo depende apenas do Firestore e do browser.

Teste 3: brute force controlado

1. Obter um hash de teste de um utilizador não produtivo.
2. Usar uma lista pequena de passwords de teste autorizadas.
3. Correr comparação local com bcrypt.
4. Confirmar que não há qualquer bloqueio, cooldown ou alerta.

### Como o ataque é executado

Há dois caminhos:

- `online`: múltiplas tentativas de login sem rate limit
- `offline`: cracking do hash fora da app, sem qualquer limite operacional

O caminho offline é muito mais perigoso.

### Solução que eu implementaria

- `Firebase Auth` com email/password ou credenciais adequadas
- regras do Firestore baseadas em `request.auth`
- opcional: MFA para perfis administrativos
- política forte de passwords
- registo e auditoria de falhas de login

## 3. Autorização client-side é forjável por manipulação de storage

Severidade: Crítico

Referências:

- `src/pages/login.tsx:49-51`
- `src/main.tsx:23-27`
- `src/main.tsx:31-58`

### O que está errado

O role é guardado localmente e usado nos guards:

- `admin`
- `empregado`
- `cliente`
- `cozinha`

Não existe assinatura nem verificação server-side.

### Impacto

- acesso ilegítimo a dashboards internos
- exposição de ecrãs administrativos
- execução de ações internas se as permissões do backend também estiverem abertas

### Como testar em pentest

Teste prático via DevTools:

1. Abrir a app.
2. Abrir DevTools.
3. Ir a `Application` -> `Local Storage` ou `Session Storage`.
4. Criar ou editar a chave `manage_eat_session`.
5. Inserir um objeto com role elevado, por exemplo:

```json
{"userId":"pentest","username":"pentest","role":"admin"}
```

6. Navegar para `/admin`.
7. Confirmar que o frontend aceita o acesso.

Variantes:

- usar `role: "cozinha"` para aceder à cozinha
- usar `role: "empregado"` para abrir o modal de QR e explorar sessões

### Como o ataque é executado

O ataque é direto:

1. adulterar storage local
2. recarregar a app
3. o guard lê o role adulterado
4. o utilizador passa a ver áreas reservadas

### Solução que eu implementaria

- remover confiança em sessão local artesanal
- usar token de auth assinado
- derivar o role do utilizador a partir de `custom claims` ou documento protegido
- aplicar autorização nas regras do Firestore e/ou Cloud Functions

## 4. `orders` permite criação pública sem autenticação nem validação de integridade

Severidade: Crítico

Referências:

- `firebase/firestore.rules:15-18`
- `src/lib/db.ts:71-78`
- `src/pages/cliente-dashboard.tsx:16-35`
- `src/pages/cliente-session.tsx:26-45`
- `src/pages/empregado-dashboard.tsx:47-71`

### O que está errado

A coleção `orders` permite:

```txt
allow create: if true;
```

Sem autenticação e sem validação de schema.

### Impacto

- spam de pedidos falsos
- pedidos em qualquer mesa
- payload arbitrário
- fraude operacional
- possível negação de serviço da cozinha

### Como testar em pentest

Teste 1: spam pela própria UI pública

1. Entrar como cliente ou usar `/mesa/:sessionId`.
2. Submeter múltiplos pedidos seguidos.
3. Confirmar que não existe:
   - throttle
   - captcha
   - validação de sessão forte

Teste 2: criação com payload adulterado

1. Intercetar o momento de criação do pedido com DevTools ou script de teste.
2. Alterar campos como:
   - `source`
   - `tableNumber`
   - `discountValue`
   - `status`
   - `items[].price`
3. Confirmar que o Firestore aceita o documento.

Teste 3: criação massiva controlada

1. Repetir pedidos com payload de teste.
2. Observar a cozinha a receber pedidos indevidos.
3. Confirmar ausência de defesa contra flood.

### Como o ataque é executado

O atacante pode fabricar documentos `orders` sem depender do fluxo UI oficial. O problema é lógico: o backend aceita diretamente o documento.

### Solução que eu implementaria

- bloquear `create` direto em `orders`
- criar uma `Cloud Function` ou API protegida para submissão de pedidos
- nessa função:
  - validar sessão/identidade
  - recalcular preços no servidor
  - validar `menuItemId` contra o menu real
  - forçar `status = "pending"`
  - limitar frequência por origem/IP/sessão

## 5. `sessions` permite leitura, criação e apagamento públicos

Severidade: Crítico

Referências:

- `firebase/firestore.rules:21-24`
- `src/lib/db.ts:88-111`
- `src/pages/empregado-dashboard.tsx:80-103`

### O que está errado

A coleção `sessions` está aberta para:

- `read`
- `create`
- `delete`

Sem autenticação.

### Impacto

- enumeração de sessões ativas
- descoberta de mesas em uso
- encerramento malicioso de sessões QR
- criação de sessões falsas

### Como testar em pentest

Teste 1: enumeração de sessões

1. Usar o cliente Firestore do projeto.
2. Ler a coleção `sessions`.
3. Confirmar que é possível obter:
   - `id`
   - `tableNumber`
   - `createdAt`
   - `expiresAt`

Teste 2: eliminação de sessão legítima

1. Obter um `sessionId` válido.
2. Executar `delete` sobre essa sessão.
3. Confirmar que o cliente real perde o QR.

Teste 3: criação de sessão falsa

1. Criar uma nova sessão com `tableNumber` arbitrário.
2. Confirmar que a app passa a reconhecer a sessão.

### Como o ataque é executado

O atacante não precisa de adivinhar IDs se a coleção for listável. O ID aleatório deixa de ter valor protetor.

### Solução que eu implementaria

- proibir listagem pública de sessões
- criar e encerrar sessões apenas através de backend autenticado
- permitir leitura da sessão apenas com um token opaco e de uso limitado
- aplicar TTL real no backend

## 6. Sessão QR revogada continua útil em páginas já abertas

Severidade: Alto

Referências:

- `src/pages/cliente-session.tsx:19-24`
- `src/pages/cliente-session.tsx:26-45`

### O que está errado

`ClienteSession` valida o `sessionId` apenas no carregamento inicial. Depois guarda `tableNumber` em estado local e deixa de revalidar.

### Impacto

- QR revogado continua a permitir pedidos
- expiração torna-se parcialmente cosmética

### Como testar em pentest

1. Abrir uma sessão QR válida em `/mesa/:sessionId`.
2. Esperar a página carregar e fixar a mesa.
3. Num segundo cliente, apagar a sessão do Firestore.
4. Voltar à primeira página e tentar confirmar um pedido.
5. Confirmar que o pedido continua a ser aceite.

### Solução que eu implementaria

- revalidar a sessão imediatamente antes de submeter o pedido
- idealmente, fazer essa validação dentro de uma função server-side
- quando a sessão expira, invalidar o pedido no backend mesmo que a UI ainda esteja aberta

## 7. Seed com credenciais previsíveis e política de passwords fraca

Severidade: Alto

Referências:

- `firebase/seed.ts:23-28`
- `src/pages/admin-dashboard.tsx:230-245`
- `src/pages/admin-dashboard.tsx:262-275`

### O que está errado

O seed cria credenciais previsíveis:

- `admin123`
- `empregado123`
- `cliente123`
- `cozinha123`

E a app aceita passwords com mínimo de 4 caracteres.

### Impacto

- compromisso imediato se seeds forem reutilizadas
- aumento de sucesso em brute force
- risco elevado em ambientes de staging/produção pouco controlados

### Como testar em pentest

1. Verificar se o seed foi corrido no ambiente alvo.
2. Tentar login com credenciais seed conhecidas em ambiente autorizado.
3. Testar criação/edição de contas com passwords curtas.
4. Confirmar ausência de requisitos mínimos robustos.

### Solução que eu implementaria

- eliminar seeds com passwords fixas
- gerar credenciais únicas e temporárias
- forçar reset inicial
- definir política mínima forte:
  - comprimento >= 12
  - bloqueio de passwords fracas
  - MFA para admin

## 8. Falta de rate limiting e proteção contra brute force

Severidade: Alto

Referências:

- `src/pages/login.tsx:30-57`

### O que está errado

Não existe:

- rate limiting
- cooldown progressivo
- bloqueio temporário
- telemetria de abuso

### Impacto

- brute force online de credenciais
- enumeração operacional
- abuso repetido sem fricção

### Como testar em pentest

1. Escolher uma conta de teste autorizada.
2. Tentar múltiplos logins falhados em sequência.
3. Confirmar que a app não:
   - atrasa respostas
   - bloqueia tentativas
   - exige verificação adicional

### Solução que eu implementaria

- mover login para serviço confiável
- aplicar rate limiting por IP, utilizador e fingerprint de sessão
- introduzir backoff progressivo
- alertas para padrões anómalos

## 9. Integridade do pedido depende totalmente do cliente

Severidade: Médio

Referências:

- `src/pages/empregado-dashboard.tsx:53-71`
- `src/pages/cliente-dashboard.tsx:22-35`
- `src/pages/cliente-session.tsx:32-45`

### O que está errado

O cliente envia no pedido:

- preços
- descontos
- origem
- notas
- ingredientes removidos
- quantidade

Nada garante que esses valores são legítimos.

### Impacto

- preços manipulados
- descontos fabricados
- origem de pedido forjada
- dados operacionais inconsistentes

### Como testar em pentest

1. Intercetar o payload antes do `addDoc`.
2. Alterar `items[].price` para valor irreal.
3. Alterar `discountType` e `discountValue`.
4. Confirmar escrita no Firestore.

### Solução que eu implementaria

- payload mínimo vindo do cliente:
  - `sessionId` ou `tableId`
  - lista de `menuItemId`
  - quantidade
  - customizações permitidas
- cálculo de preço e desconto apenas no backend

## 10. Ausência de App Check facilita abuso por clientes externos

Severidade: Médio

Referências:

- `src/lib/firebase.ts:1-14`

### O que está errado

A config do Firebase é pública, como é normal numa SPA, mas não existe App Check nem outra barreira que restrinja chamadas a clientes legítimos.

### Impacto

- scripts externos podem abusar das coleções abertas
- uso da infraestrutura fora da app oficial

### Como testar em pentest

1. Reproduzir leitura/escrita a partir de um cliente externo que não seja a app.
2. Confirmar que as operações continuam válidas.

### Solução que eu implementaria

- ativar Firebase App Check
- continuar a assumir que App Check não substitui regras corretas
- usar App Check como camada adicional, não principal

## 11. Ausência de headers/políticas básicas de hardening

Severidade: Médio

Referências:

- `index.html:1-10`

### O que está errado

Não há evidência no projeto de:

- `Content-Security-Policy`
- `frame-ancestors`
- `X-Content-Type-Options`
- `Referrer-Policy`

### Impacto

- menor resistência contra futuras falhas de XSS
- maior flexibilidade para embedding/clickjacking, dependendo da infra final

### Como testar em pentest

1. Servir a app em ambiente real.
2. Inspecionar response headers.
3. Confirmar ausência das políticas acima.

### Solução que eu implementaria

- configurar CSP estrita
- bloquear framing externo
- definir `Referrer-Policy: strict-origin-when-cross-origin`
- definir `X-Content-Type-Options: nosniff`

## 12. Ausência de `.gitignore` na raiz aumenta risco de exposição acidental

Severidade: Médio

Referências:

- não existe `.gitignore` na raiz da app
- `.env.local` presente

### O que está errado

Sem `.gitignore`, é fácil versionar por engano:

- `.env.local`
- `node_modules`
- `dist`
- artefactos temporários

### Impacto

- risco de leak acidental de configuração ou segredos futuros

### Como testar em pentest

1. Rever o repositório.
2. Confirmar ausência de `.gitignore`.
3. Validar se ficheiros sensíveis entram em `git status`.

### Solução que eu implementaria

Adicionar `.gitignore` com pelo menos:

```gitignore
node_modules/
dist/
.env
.env.*
*.log
```

## Findings negativos: o que não encontrei nesta revisão

Estes pontos foram procurados no código revisto e não foram identificados diretamente:

- `dangerouslySetInnerHTML`
- `innerHTML`
- `eval`
- `new Function`
- `document.write`
- uploads de ficheiros
- SQL injection
- command injection
- SSRF
- path traversal no servidor
- leitura arbitrária de ficheiros locais via backend
- open redirect explícito

Importante:

- isto não prova ausência absoluta
- significa apenas que não encontrei superfície para essas classes no código analisado

## Sobre "leitura de caminhos individuais"

Na arquitetura atual, a app é uma SPA sem backend custom com leitura de ficheiros. Por isso:

- não identifiquei endpoint de leitura arbitrária de caminhos do servidor
- não identifiquei path traversal clássico do tipo `../../etc/passwd`

O que existe, isso sim, é:

- acesso direto a rotas da SPA
- enumeração de rotas a partir do bundle/código
- acesso indevido a páginas internas após adulteração da sessão local

Ou seja: o problema é `route access control`, não `file path traversal`.

## Solução técnica completa que eu implementaria

## 1. Novo modelo de autenticação

### Objetivo

Eliminar completamente auth baseada em `users + bcrypt no browser`.

### Solução

- usar `Firebase Auth`
- login real com token emitido pela plataforma
- contas administrativas e internas associadas a utilizadores autenticados
- roles guardados em `custom claims` ou documento `profiles/{uid}`

### Resultado

- deixa de existir hash de password no frontend
- deixa de existir sessão artesanal no storage
- guards passam a refletir estado autenticado real

## 2. Novo modelo de autorização

### Princípio

Todo o acesso deve depender de `request.auth`, nunca de storage local.

### Estrutura sugerida

- `profiles/{uid}`:
  - `role`
  - `restaurantId`
  - `active`

- `restaurants/{restaurantId}/...`

### Regras de acesso

- `admin`: gerir menu, utilizadores internos e relatórios
- `empregado`: criar pedidos, gerir mesas e sessões QR
- `cozinha`: ler pedidos e atualizar estados autorizados
- `cliente`: nunca recebe acesso generalizado ao Firestore

## 3. Mover operações críticas para Cloud Functions ou backend

Operações que eu retiraria do frontend:

- login
- criação de pedido
- criação de sessão QR
- encerramento de sessão QR
- atualização de estado do pedido
- gestão de utilizadores

### Exemplo de fluxo seguro para pedido

1. cliente envia `sessionToken` + itens
2. backend valida a sessão
3. backend lê o menu real
4. backend calcula preço final
5. backend grava pedido com schema controlado

## 4. Regras novas do Firestore

As regras deveriam tender para isto:

```txt
- users: sem leitura pública
- profiles: leitura do próprio utilizador; escrita restrita
- orders: sem create público direto
- sessions: sem listagem pública
- menu: leitura pública apenas se necessário
```

### Exemplo de direção correta

```txt
match /users/{id} {
  allow read, write: if false;
}
```

```txt
match /orders/{id} {
  allow create: if false;
  allow read: if isKitchenOrAdmin();
  allow update: if isKitchenOrAdmin();
}
```

```txt
match /sessions/{id} {
  allow read, create, delete: if false;
}
```

## 5. Proteção específica para QR

Eu substituiria o modelo atual por:

- token opaco de sessão QR
- TTL curto
- binding a `restaurantId` e `tableNumber`
- revogação central
- validação em backend por pedido

Opcionalmente:

- nonce por dispositivo
- limite de pedidos por minuto por sessão

## 6. Proteção contra brute force e abuso

### Login

- rate limit por IP
- rate limit por utilizador
- backoff progressivo
- MFA para admin

### Pedidos

- throttling por sessão
- throttling por mesa
- throttling por IP
- deteção de picos anómalos

## 7. Hardening do frontend e deployment

- CSP
- `frame-ancestors 'none'` ou restrito
- `Referrer-Policy`
- `nosniff`
- App Check
- ambiente separado por `dev/staging/prod`
- logging de segurança

## 8. Higiene de credenciais e repositório

- remover passwords seed fixas
- usar `.gitignore`
- nunca guardar segredos reais em `.env` versionável
- rodar credenciais já existentes se houve qualquer exposição

## Ordem recomendada de remediação

### Fase 1: bloquear risco imediato

1. Fechar leitura pública de `users`
2. Fechar `create` público de `orders`
3. Fechar `read/create/delete` público de `sessions`
4. Desativar contas seed previsíveis

### Fase 2: refatoração obrigatória

1. Migrar login para `Firebase Auth`
2. Remover sessão artesanal do browser
3. Criar backend/Cloud Functions para pedidos e QR
4. Reescrever regras do Firestore com `request.auth`

### Fase 3: hardening

1. App Check
2. rate limiting
3. headers de segurança
4. audit trail
5. monitorização de abuso

## Conclusão final

O problema central da Manage Eat não é falta de patching de dependências. O `npm audit` está limpo neste momento. O problema real é que a app confia no cliente para:

- autenticar
- autorizar
- escolher role
- criar pedidos
- gerir sessões QR

Enquanto esse modelo existir, qualquer correção superficial será insuficiente.

Se quiseres transformar esta app numa base segura, o passo certo não é “ajustar um ou dois ifs”. É:

1. mudar o modelo de auth
2. retirar operações críticas do frontend
3. fechar o Firestore por defeito
4. reabrir só o mínimo necessário com regras e backend confiáveis
