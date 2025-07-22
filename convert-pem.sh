#!/bin/bash

# Usage: ./convert-pem.sh path/to/private-key.pem

if [ -z "$1" ]; then
  echo "Usage: $0 path/to/private-key.pem"
  exit 1
fi

pem_file="$1"

if [ ! -f "$pem_file" ]; then
  echo "File not found: $pem_file"
  exit 1
fi

# Convert to single line with \n for each original newline
escaped=$(awk '{printf "%s\\n", $0}' "$pem_file")

echo "$escaped"

