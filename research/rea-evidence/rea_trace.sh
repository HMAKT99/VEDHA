#!/bin/zsh
# usage: rea_trace.sh <id> <seedkind> <value> [match=exact|substring] [direction]
export PATH=$HOME/.local/rea/bin:$HOME/.nvm/versions/node/v22.20.0/bin:$PATH
cd "$(dirname $0)"
jq -c --arg k "$2" --arg v "$3" --arg m "${4:-exact}" --arg d "${5:-both}" '{application:., seed:{kind:$k,value:$v,match:$m,case_sensitive:true}, direction:$d}' pwcore-src-analysis.json > queries/$1-req.json
rea trace-application-feature queries/$1-req.json --json > queries/$1-out.json 2> queries/$1-err.txt
rm queries/$1-req.json
echo "$1 $2=$3 -> $(wc -c < queries/$1-out.json) bytes"
