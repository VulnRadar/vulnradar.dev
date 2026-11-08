# Sourced ahead of a gate script by tests/repo/scan-gate-parity.test.ts, where
# the real jq is not installed (CI has it, and runs the same cases through it).
#
# It answers each call the gate scripts make by what that call reads: the scan
# id, "completed", a summary guard that passes, nothing not checked. A count
# read (.critical, .high, ...) prints FAKE_COUNT_<name>, which holds the text
# the real jq prints for that value without -r. With -r a JSON string comes
# out unquoted with its escapes decoded, as jq -r prints it, so a script that
# reads the counts raw sees what it would see against the real jq. FAKE_SCAN_ID,
# FAKE_STATUS, FAKE_ERROR, FAKE_INCOMPLETE, FAKE_PAGE_MESSAGE and
# FAKE_REDIRECT_HOST replace what the other reads print, as jq -r would.
jq() {
  cat > /dev/null
  raw=false
  for arg in "$@"; do
    case "$arg" in -r) raw=true ;; esac
  done
  case "$*" in
    *"-n "*) echo '{}' ;;
    *scanId*) printf '%s\n' "${FAKE_SCAN_ID:-abc123}" ;;
    *"-e "*) return 0 ;;
    *--argjson*) echo '{}' ;;
    *result.incomplete*) printf '%s\n' "${FAKE_INCOMPLETE:-}" ;;
    *redirectHost*)
      if [ -n "${FAKE_REDIRECT_HOST:-}" ]; then
        printf '%s\n' "$FAKE_REDIRECT_HOST"
      fi
      ;;
    *pageUnreachable*)
      if [ -n "${FAKE_PAGE_MESSAGE:-}" ]; then
        printf '%s\n' "$FAKE_PAGE_MESSAGE"
      fi
      ;;
    *failureKind*) ;;
    *.error*) printf '%s\n' "${FAKE_ERROR:-unknown error}" ;;
    *.status*) printf '%s\n' "${FAKE_STATUS:-completed}" ;;
    *)
      for arg in "$@"; do
        case "$arg" in
          .critical | .high | .medium | .low | .total | .suppressed)
            value=$(printenv "FAKE_COUNT_${arg#.}" || echo 0)
            case "$raw:$value" in
              'true:"'*)
                value=${value#'"'}
                printf '%b' "${value%'"'}"
                echo
                ;;
              *)
                printf '%s' "$value"
                echo
                ;;
            esac
            return 0
            ;;
        esac
      done
      ;;
  esac
}
