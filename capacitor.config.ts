import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.manageeat.app',
  appName: 'Manage Eat',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  },
  android: {
    allowMixedContent: true
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      // Fundo do splash do plugin alinhado com o tema claro (o default novo).
      backgroundColor: '#f6f7f8'
    },
    Keyboard: {
      resize: 'native'
    },
    // Notificações locais do empregado (Fase 2). O smallIcon é um vetor
    // monocromático (res/drawable/ic_stat_notify.xml) — o Android exige um ícone
    // branco/transparente, senão mostra um quadrado branco. iOS usa o ícone da app.
    LocalNotifications: {
      smallIcon: 'ic_stat_notify',
      iconColor: '#1759d2'
    },
    // OTA em modo MANUAL: o JS decide quando e de que URL (servidor do
    // restaurante) descarregar — ver src/lib/ota.ts. A publicKey ativa a
    // encriptação E2E v2: a app só aceita bundles assinados/encriptados com a
    // chave privada (.capgo_key_v2, fora do repo). Trocar a chave obriga a
    // reconstruir e reinstalar a app nativa em todos os POS.
    CapacitorUpdater: {
      autoUpdate: false,
      publicKey: '-----BEGIN RSA PUBLIC KEY-----\nMIIBCgKCAQEA1qO7Yig8zEvgRSOGOI3wsroFZ5l2TjMjQvvMPBg5NDj0OnsAwpme\n9lY3pihfi991vMob4zg0/sdWV4RPMzPJZI/91WGEhg6aqGbT5lmZ7h6atVlS3wHu\nP2oCy0wzUM9kNnII3b9T1dB/QtmGwFVtk8AnRdaSzmyxmOsqZw9TkY89aaowBANq\nbaIfnqNGwjg1wwQGvFo5Qo5q9bzm1ye+r1yktosFNPt5J7LIVAUqzSQ3jPfXlb/T\n17FwT5y/eTwaZGUeXc3eh0ykhLjLlPq5dgfqBWJXwzPOqkx1qsomaOs6xgSvmpJ7\nTRnYd5C2gkqTCIEGEMe2hq9o7DrROn78JwIDAQAB\n-----END RSA PUBLIC KEY-----\n'
    }
  }
};

export default config;
