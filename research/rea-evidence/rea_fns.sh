#!/bin/zsh
# list functions/methods REA recovered (semantic graph) in a module: rea_fns.sh server/browserType.ts
cd "$(dirname $0)"
jq -r --arg m "$1" '.normalized_result.semantic_graph.nodes[]|select(.kind=="function" and .identity.module_path==$m)|"\(.identity.source_range.start.line)-\(.identity.source_range.end.line) \(.label)"' pwcore-src-analysis.json | sort -n | awk '{printf "%s ", $0} END{print ""}'
