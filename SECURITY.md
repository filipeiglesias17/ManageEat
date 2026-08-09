# Segurança do ManageEat

## Âmbito

O ManageEat foi concebido para funcionar na rede local de um restaurante. A base
de dados, a autenticação e o serviço Realtime são fornecidos por uma instalação
local do Supabase. Não existe um servidor de aplicação ou serviço cloud obrigatório.

Esta é uma versão beta. Antes de a utilizar com dados reais, o responsável pelo
restaurante deve rever as limitações abaixo, manter cópias de segurança e atualizar
as dependências.

## Arquitetura e fronteiras de confiança

Os clientes que entram pelo QR comunicam diretamente com a API local do Supabase.
O acesso é limitado à sessão da mesa e às operações públicas previstas pelas
políticas RLS e pelos triggers da base de dados.

Os perfis de staff autenticam-se com Supabase Auth. Na rede local, os pedidos do
staff são encaminhados por um proxy TLS, cujo certificado deve ser instalado nos
dispositivos autorizados. O frontend continua acessível por HTTP na LAN; dados
autenticados e operações sensíveis seguem pelo endpoint TLS.

A chave `service_role` não é incluída no bundle nem enviada para o browser. É usada
apenas por scripts locais de administração, seed, auditoria e cópias de segurança.

## Controlo de acesso e sessões QR

As políticas RLS em `supabase/migrations/` e as funções de validação em
`supabase/sql/functions/` são a principal barreira de autorização. Entre outras
regras, verificam o perfil, o turno ativo, a transição de estados, os campos
controlados pelo servidor e os limites de cada sessão.

Uma sessão QR fica ligada à mesa e ao respetivo ciclo de abertura. Reabrir uma
conta cria um novo contexto de acesso; um código permanente não dá acesso a ciclos
anteriores. Pagamentos anulados e contas reabertas usam os valores registados no
momento do pagamento, evitando alterações retroativas quando as definições mudam.

A auditoria automatizada pode ser executada com `npm run gate:rules`. Deve correr
contra o Supabase local inicializado e com os dados de demonstração aplicados.

## Cópias de segurança

Os dados do restaurante vivem no volume local do Docker. Os comandos de reset ou
restauro podem substituir dados e exigem confirmação. O launcher cria snapshots
antes de operações de risco. O agendamento automático diário foi validado apenas
em macOS; noutros sistemas deve ser configurado e testado pelo operador.

As cópias devem ser guardadas também fora da máquina do restaurante e o restauro
deve ser ensaiado periodicamente. Uma cópia nunca testada não é garantia de recuperação.

## Reportar uma vulnerabilidade

Não publiques dados sensíveis, credenciais ou uma prova de conceito explorável
numa issue pública. Usa o formulário privado **Report a vulnerability** no separador
Security do repositório GitHub. Inclui a versão afetada, os passos de reprodução,
o impacto observado e, se possível, uma correção sugerida.

## Limites conhecidos

- A aplicação ainda não foi validada num dispositivo Android real.
- As escritas offline não são colocadas numa fila; falham de forma visível até a
  rede ficar disponível.
- O TLS depende da instalação e confiança da autoridade certificadora local nos
  dispositivos de staff.
- As notificações nativas dependem de a aplicação estar aberta; não existe serviço
  de push remoto.
- A exportação SAF-T é experimental e não substitui software fiscal certificado.
- A proteção depende também da segurança física da máquina, da rede Wi-Fi e das
  contas do sistema operativo.

## Verificação antes de uma release

Executar, no mínimo:

```bash
npm ci
npx eslint . --max-warnings=0
npx tsc -b --pretty false
npm test -- --run
npm run build
npm audit --omit=dev
npm run gate:rules
npm run qa:smoke
```

Os dois últimos comandos exigem o Supabase local, seed e o frontend em execução.
