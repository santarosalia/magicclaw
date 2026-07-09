#!/usr/bin/env bash
# Returns 0 when Node's node:sqlite supports FTS5.
node_supports_fts5() {
  local node_bin="${1:?node binary required}"
  "$node_bin" -e '
    const { DatabaseSync } = require("node:sqlite");
    const db = new DatabaseSync(":memory:");
    db.exec("CREATE VIRTUAL TABLE _probe USING fts5(x)");
    db.exec("DROP TABLE _probe");
  ' >/dev/null 2>&1
}
