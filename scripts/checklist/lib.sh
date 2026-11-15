# Shell helpers for docs/api-validation-checklist.md. Source it in bash or zsh:
#
#   export BASE=http://127.0.0.1:4110 S=/tmp/relkit-checklist/<item-id>
#   source scripts/checklist/lib.sh
#
# BASE is the running application; S is a state folder holding one cookie jar per actor
# (owner.jar, admin.jar, ...) and ids.env, written by scripts/checklist/setup-actors.sh.
# (Variable names avoid `path` and `status`: zsh reserves both.)

: "${BASE:=http://127.0.0.1:4110}"

# call <actor> <METHOD> <url-path> [json-body] [extra curl args...]
#   Sends one request as <actor> (cookie jar $S/<actor>.jar, updated with Set-Cookie).
#   Actor "anon" sends no cookie and keeps none. Every request carries `Origin: $BASE`;
#   set NO_ORIGIN=1 to leave it out, or ORIGIN=<value> to send another one.
#   Prints the response body, then a line "HTTP <status> x-request-id: <id>".
call() {
  local actor=$1 verb=$2 target=$3 body=""
  shift 3
  # The fourth argument is the JSON body unless it is a curl option ("-o", "--data-binary", ...).
  if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then body=$1; shift; fi
  local args
  args=(-sS -X "$verb" "$BASE$target")
  if [ -z "${NO_ORIGIN-}" ]; then args+=(-H "Origin: ${ORIGIN:-$BASE}"); fi
  if [ "$actor" != "anon" ]; then args+=(-b "$S/$actor.jar" -c "$S/$actor.jar"); fi
  if [ -n "$body" ]; then args+=(-H "Content-Type: application/json" --data-binary "$body"); fi
  curl "${args[@]}" "$@" -w '\nHTTP %{http_code} x-request-id: %header{x-request-id}\n'
}

# code <actor> <METHOD> <url-path> [json-body] [extra curl args...]  -> prints only the status code
code() {
  call "$@" -o /dev/null | tail -n 1 | awk '{print $2}'
}

# json <actor> <METHOD> <url-path> [json-body] [extra curl args...]  -> prints only the body (pipe it to jq)
json() {
  call "$@" | sed '$d'
}

# sql '<query>'  -> runs a read-only check against DATABASE_URL from ./.env (run from the project root).
#   Columns are camelCase and need double quotes: sql 'select "unassignedAt" from driver_assignment'
sql() {
  psql "$(grep '^DATABASE_URL=' "${ENV_FILE:-.env}" | cut -d= -f2-)" -Atc "$1"
}
