#!/bin/bash
# Arranque do ManageEat (cópia limpa): duplo clique abre o Terminal e corre o launcher.
cd "$(dirname "$0")"
node scripts/launcher/manage-eat.mjs start
