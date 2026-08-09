#!/bin/bash
# Build da app iOS: compila o frontend, sincroniza o projeto nativo e abre o Xcode-beta.
cd "$(dirname "$0")"
echo "→ 1/2 Build web + sync do projeto iOS (npm run cap:build)…"
npm run cap:build
if [ $? -ne 0 ]; then
  echo ""
  echo "✗ O build falhou — vê os erros acima. (Esta janela fica aberta.)"
  exit 1
fi
echo ""
echo "→ 2/2 A abrir o Xcode-beta com ios/App/App.xcodeproj…"
open -a "Xcode-beta" ios/App/App.xcodeproj
echo "✓ Pronto: no Xcode escolhe o teu iPhone no seletor de dispositivo e carrega em Run (▶)."
