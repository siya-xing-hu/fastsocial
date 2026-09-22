#!/bin/sh
set -eu

sync_artifact() {
  source_directory="$1"
  output_directory="$2"
  mkdir -p "$output_directory"
  find "$output_directory" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +
  cp -R "$source_directory"/. "$output_directory"/
}

sync_artifact /opt/fast-social/server /output/server
sync_artifact /opt/fast-social/extension /output/extension

exec node --enable-source-maps /opt/fast-social/server/index.js
