# Integração do Capacitor (iOS & Android)

Este projeto utiliza o **Capacitor** para permitir compilar a aplicação React existente em aplicações móveis nativas para iOS e Android.

---

## Pré-requisitos

Para trabalhar com as versões nativas, garanta que tem as seguintes ferramentas instaladas:

1. **Geral**: Node.js, npm, e Docker (para correr o Supabase local).
2. **iOS**: 
   - macOS
   - Xcode (instalado via App Store) — o projeto usa **Swift Package Manager (SPM)**, já incluído no Xcode (não precisa de CocoaPods).
   - Ferramentas de linha de comandos do Xcode (`xcode-select --install`)
   - **Xcode beta / macOS recente:** se o build/run usa o `Xcode-beta.app`, alinhe a CLI com `sudo xcode-select -s /Applications/Xcode-beta.app/Contents/Developer` (ou prefixe os comandos com `DEVELOPER_DIR=/Applications/Xcode-beta.app/Contents/Developer`). CLI e GUI têm de usar o **mesmo** Xcode, senão a resolução de pacotes SPM fica inconsistente.
3. **Android**:
   - Android Studio
   - Android SDK
   - Java Development Kit (JDK) 17 ou superior

---

## Comandos Úteis (Workflow)

Os seguintes scripts foram adicionados ao `package.json`:

* **`npm run build`**: Compila a aplicação web React para a diretoria `dist/`.
* **`npm run cap:sync`**: Sincroniza a diretoria `dist/` e todas as configurações web com os projetos iOS e Android nativos. **Sempre que alterar código React/CSS, deve correr `npm run build && npm run cap:sync`**.
* **`npm run cap:open:ios`**: Abre o projeto iOS no Xcode. A partir do Xcode pode compilar e correr o simulador do iPhone ou um dispositivo real.
* **`npm run cap:open:android`**: Abre o projeto Android no Android Studio.

---

## Ligação ao Supabase Local

Como o Supabase corre localmente via Docker na sua máquina de desenvolvimento (`127.0.0.1:54321`):
* O emulador de Android e os dispositivos móveis na rede local não conseguem aceder à máquina via `localhost` ou `127.0.0.1`.
* O ficheiro `src/lib/supabase.ts` foi atualizado para detetar se a aplicação está a correr dentro do Capacitor.
* Se estiver a correr no Capacitor, a aplicação irá ligar-se diretamente ao IP de rede local da sua máquina (gerado dinamicamente no build no parâmetro `import.meta.env.VITE_LOCAL_NETWORK_HOST`).

### Configurações de Rede Efetuadas

Para permitir o tráfego HTTP sem HTTPS (cleartext) que o Supabase local usa por omissão:
1. **Android**: Foi configurado `android:usesCleartextTraffic="true"` no [AndroidManifest.xml](../android/app/src/main/AndroidManifest.xml).
2. **iOS**: Foi configurada a chave `NSAppTransportSecurity` -> `NSAllowsArbitraryLoads` no [Info.plist](../ios/App/App/Info.plist).

### Quando o IP da máquina muda (reconexão automática)

O IP da LAN é "queimado" no build (`VITE_LOCAL_NETWORK_HOST`). Para a app não exigir
reconfiguração manual a cada blip de rede ou reabertura, a descoberta tenta os
servidores por esta ordem (ver [network-discovery.ts](../src/lib/network-discovery.ts)):

1. **Servidor manual** (Definições de ligação) — autoritário, ganha sempre.
2. **Último servidor que funcionou** — guardado em localStorage ao ligar com sucesso.
3. **IP do build** — o `VITE_LOCAL_NETWORK_HOST`.

Assim, depois de ligar uma vez ao endereço certo, a app religa-se sozinha a esse
endereço (mesmo após "Voltar ao automático").

> **Limite:** isto só religa a servidores **já conhecidos**. Se o IP da máquina mudar
> para um valor nunca usado e sem servidor manual definido, a app não o adivinha
> (a descoberta zeroconf foi removida por não funcionar em iOS/SPM). Para evitar
> reconfigurar: reserva um **IP fixo** (DHCP reservation) para a máquina do servidor,
> ou refaz `npm run build && npm run cap:sync` depois de o IP mudar.

---

## Atualizações OTA (over-the-air) do código da app

Permite atualizar o **código** da app (JS/HTML/CSS) no telemóvel **sem recompilar**
nem App Store — o bundle é descarregado do Supabase do próprio restaurante.

**Pré-requisito (uma vez):** compilar e instalar **um** build nativo com o plugin
`@capgo/capacitor-updater` já incluído (`npm run cap:build` → Xcode/Android Studio →
instalar no dispositivo). A partir daí, o código vai por OTA.

**Publicar uma nova versão (programador):**
```bash
npm run ota:publish   # build + zip do dist/ + upload p/ Storage + aponta app_release
```
O telemóvel (na mesma Wi-Fi) deteta a nova versão (via Realtime/arranque/resume),
descarrega-a em fundo e aplica-a no próximo arranque. O banner "Atualizar agora"
([update-banner.tsx](../src/components/update-banner.tsx))
permite aplicar já. A versão a correr aparece no rodapé (`v0.0.0+…`).

**Como funciona:** [ota.ts](../src/lib/ota.ts)
compara `VITE_BUILD_VERSION` (injetada no build) com a tabela `app_release`; o
modo é **manual** (`CapacitorUpdater.autoUpdate:false` no capacitor.config) e o URL
do bundle é resolvido em runtime para o servidor do restaurante. `notifyAppReady()`
ativa o **rollback** automático (um bundle que rebente volta ao anterior).

> **Limite:** OTA só troca a camada web. Mudar código nativo, plugins ou a versão
> do Capacitor exige um **novo binário** (App Store/TestFlight no iOS; APK no Android).

> **Futuro (open-source):** feed central no GitHub Releases — o admin descarrega a
> versão oficial e publica-a no Supabase do seu restaurante. Ver o plano.

## Desenvolvimento com Live Reload (Opcional)

Se preferir testar em tempo real no simulador/dispositivo sem precisar de fazer build & sync a cada alteração, pode correr o servidor de desenvolvimento do Vite e apontar o Capacitor para ele:

1. Inicie o servidor Vite exposto na rede:
   ```bash
   npm run dev
   ```
   Note o IP exibido no terminal (ex: `http://192.168.1.150:5173`).

2. No [capacitor.config.ts](../capacitor.config.ts), adicione temporariamente a secção `server`:
   ```typescript
   import type { CapacitorConfig } from '@capacitor/cli';

   const config: CapacitorConfig = {
     appId: 'com.manageeat.app',
     appName: 'Manage Eat',
     webDir: 'dist',
     server: {
       url: 'http://192.168.1.150:5173', // Substitua pelo IP real da sua máquina
       cleartext: true
     }
   };

   export default config;
   ```

3. Corra o sync para atualizar a configuração nativa:
   ```bash
   npm run cap:sync
   ```

4. Abra a plataforma no Xcode/Android Studio e corra a aplicação. Qualquer alteração no código será refletida instantaneamente no telemóvel/emulador.

> **Importante**: Remova a propriedade `server.url` antes de gerar a versão final de produção da aplicação.
