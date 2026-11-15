# Sourced ahead of a gate script by tests/repo/scan-gate-parity.test.ts.
#
# A curl that never reaches the network. Starting a scan answers 201 with a
# plain scan id, and every other request answers 200 with FAKE_STATUS_BODY, so
# the first status poll finds the scan completed. FAKE_CREATE_CODE and
# FAKE_CREATE_BODY replace the start's answer, FAKE_STATUS_CODE the polls'. It
# answers in the two shapes the scripts ask for: the body to the -o file and
# the status code on stdout (the GitLab template), or the body, a newline and
# the code (the Action).
#
# With FAKE_CURL_ARGV set, every argument of every call is appended to that
# file, one per line, and a line holding only "--" ends each call. With
# FAKE_CURL_STDIN set, what a call that reads its headers from stdin (-H @-)
# was given is appended to that file. A call with @- always drains stdin, as
# curl does, so the printf feeding it never writes into a closed pipe.
curl() {
  code="${FAKE_STATUS_CODE:-200}"
  body="$FAKE_STATUS_BODY"
  out=''
  prev=''
  stdin_headers=false
  for arg in "$@"; do
    case "$arg" in
      POST)
        code="${FAKE_CREATE_CODE:-201}"
        body='{"scanId":"abc123"}'
        if [ -n "${FAKE_CREATE_BODY:-}" ]; then body="$FAKE_CREATE_BODY"; fi
        ;;
    esac
    case "$prev:$arg" in -H:@-) stdin_headers=true ;; esac
    case "$prev" in -o) out="$arg" ;; esac
    if [ -n "${FAKE_CURL_ARGV:-}" ]; then printf '%s\n' "$arg" >> "$FAKE_CURL_ARGV"; fi
    prev="$arg"
  done
  if [ -n "${FAKE_CURL_ARGV:-}" ]; then printf '%s\n' "--" >> "$FAKE_CURL_ARGV"; fi
  if [ "$stdin_headers" = "true" ]; then
    if [ -n "${FAKE_CURL_STDIN:-}" ]; then
      cat >> "$FAKE_CURL_STDIN"
    else
      cat > /dev/null
    fi
  fi
  if [ -n "$out" ]; then
    printf '%s' "$body" > "$out"
    printf '%s' "$code"
  else
    printf '%s' "$body"
    echo
    printf '%s' "$code"
  fi
}
