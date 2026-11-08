# Sourced ahead of a gate script by tests/repo/scan-gate-parity.test.ts.
#
# A curl that never reaches the network. Starting a scan answers 201 with a
# plain scan id, and every other request answers 200 with FAKE_STATUS_BODY, so
# the first status poll finds the scan completed. It answers in the two shapes
# the scripts ask for: the body to the -o file and the status code on stdout
# (the GitLab template), or the body, a newline and the code (the Action).
curl() {
  code=200
  body="$FAKE_STATUS_BODY"
  out=''
  prev=''
  for arg in "$@"; do
    case "$arg" in
      POST)
        code=201
        body='{"scanId":"abc123"}'
        ;;
    esac
    case "$prev" in -o) out="$arg" ;; esac
    prev="$arg"
  done
  if [ -n "$out" ]; then
    printf '%s' "$body" > "$out"
    printf '%s' "$code"
  else
    printf '%s' "$body"
    echo
    printf '%s' "$code"
  fi
}
