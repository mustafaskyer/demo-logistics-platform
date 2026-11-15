#!/usr/bin/env bash
# Creates the actors of docs/api-validation-checklist.md against a running application:
#   company A: owner, admin, dispatcher, driver, member (each with company A active)
#   company B: ownerB
#   nocompany: a signed-in user without any company
# Every run uses new e-mails and slugs, so it can be repeated on the same database.
#
# usage: BASE=http://127.0.0.1:4110 scripts/checklist/setup-actors.sh <state-folder>
# writes <state-folder>/<actor>.jar (curl cookie jars) and <state-folder>/ids.env
set -euo pipefail

S=${1:?usage: setup-actors.sh <state-folder>}
export S
mkdir -p "$S"
. "$(dirname "$0")/lib.sh"

RUN=$(date +%s)$((RANDOM % 1000))
PASSWORD=correct-horse-battery
rm -f "${S:?}"/*.jar "${S:?}/ids.env"

# expect <status> <actor> <METHOD> <path> [json]  -> body on stdout, fails on another status
expect() {
  local want=$1 out code
  shift
  out=$(call "$@")
  code=$(printf '%s\n' "$out" | tail -n 1 | awk '{print $2}')
  if [ "$code" != "$want" ]; then
    printf 'FAILED: %s %s as %s answered %s, expected %s\n%s\n' "$2" "$3" "$1" "$code" "$want" "$out" >&2
    exit 1
  fi
  printf '%s\n' "$out" | sed '$d'
}

sign_up() { # actor -> user id
  expect 200 "$1" POST /api/auth/sign-up/email \
    "{\"name\":\"Checklist $1\",\"email\":\"checklist-$RUN-$1@example.test\",\"password\":\"$PASSWORD\"}" | jq -r .user.id
}

OWNER_ID=$(sign_up owner)
COMPANY_A=$(expect 200 owner POST /api/auth/organization/create \
  "{\"name\":\"Checklist A $RUN\",\"slug\":\"checklist-a-$RUN\",\"legalName\":\"Checklist A LLC\",\"country\":\"EG\"}" | jq -r .id)

declare -a lines=()
for role in admin dispatcher driver member; do
  uid=$(sign_up "$role")
  inv=$(expect 200 owner POST /api/auth/organization/invite-member \
    "{\"email\":\"checklist-$RUN-$role@example.test\",\"role\":\"$role\"}" | jq -r .id)
  expect 200 "$role" POST /api/auth/organization/accept-invitation "{\"invitationId\":\"$inv\"}" >/dev/null
  expect 200 "$role" POST /api/auth/organization/set-active "{\"organizationId\":\"$COMPANY_A\"}" >/dev/null
  upper=$(printf '%s' "$role" | tr '[:lower:]' '[:upper:]')
  lines+=("${upper}_ID=$uid")
done

OWNERB_ID=$(sign_up ownerB)
COMPANY_B=$(expect 200 ownerB POST /api/auth/organization/create \
  "{\"name\":\"Checklist B $RUN\",\"slug\":\"checklist-b-$RUN\"}" | jq -r .id)
NOCOMPANY_ID=$(sign_up nocompany)

{
  echo "BASE=$BASE"
  echo "RUN=$RUN"
  echo "PASSWORD=$PASSWORD"
  echo "COMPANY_A=$COMPANY_A"
  echo "COMPANY_B=$COMPANY_B"
  echo "OWNER_ID=$OWNER_ID"
  printf '%s\n' "${lines[@]}"
  echo "OWNERB_ID=$OWNERB_ID"
  echo "NOCOMPANY_ID=$NOCOMPANY_ID"
  echo "EMAIL_PREFIX=checklist-$RUN-"
} >"$S/ids.env"

active=$(json owner GET /api/auth/get-session | jq -r .session.activeOrganizationId)
[ "$active" = "$COMPANY_A" ] || { echo "FAILED: owner's active company is $active, expected $COMPANY_A" >&2; exit 1; }
echo "actors ready in $S (company A $COMPANY_A, company B $COMPANY_B)"
