#!/usr/bin/env bash
# sciplot dev helper
set -euo pipefail
cd "$(dirname "$0")"

usage() {
  echo "usage: ./run.sh validate|test|engines|install|status"
}

case "${1:-}" in
  validate) claude plugin validate . ;;
  test)     claude plugin test . ;;
  engines)
    for c in uv Rscript pdflatex pdftocairo wolframscript octave-cli matlab; do
      printf "%-14s %s\n" "$c" "$(command -v "$c" || echo -)"
    done ;;
  install)
    claude plugin marketplace add "$PWD"
    claude plugin install sciplot@sciplot ;;
  status)   git status --short ;;
  *)        usage; exit 1 ;;
esac
