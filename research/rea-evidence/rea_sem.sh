#!/bin/zsh
# usage: EV=<analysis.json> rea_sem.sh <id> <module_path> <function_label> <direction>
export PATH=$HOME/.local/rea/bin:$HOME/.nvm/versions/node/v22.20.0/bin:$PATH
cd "$(dirname $0)"
EVF=${EV:-pwcore-src-analysis.json}
NID=$(jq -r --arg m "$2" --arg l "$3" '[.normalized_result.semantic_graph.nodes[]|select(.kind=="function" and .identity.module_path==$m and .label==$l)][0].node_id' $EVF)
jq -c --arg n "$NID" --arg d "$4" '{application:., query:{seed:{kind:"semantic-node",node_id:$n},direction:$d,include_ambiguous_dynamic_edges:false,expected:null}}' $EVF > queries/$1-req.json
rea trace-javascript-semantics queries/$1-req.json --json > queries/$1-out.json 2> queries/$1-err.txt
rm queries/$1-req.json
echo "$1 $2:$3 $4 node=$NID -> $(jq -c '.normalized_result|{status,summary,coverage}' queries/$1-out.json 2>/dev/null | head -c 500)"
