# Pinned CI tools. Each workflow builds one stage with --target. This file
# exists so Dependabot's docker ecosystem keeps every tag and digest current:
# it cannot see an image named inside a workflow, and it moves a FROM line's
# tag and digest together.
#
#   docker build --target <tool> -t vr-<tool> .github/tools
#
# BuildKit builds only the stage asked for. tests/repo/workflow-hardening.test.ts
# requires every line below to carry a tag and a digest, and every --target a
# workflow names to exist here.
FROM rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 AS actionlint
FROM ghcr.io/zizmorcore/zizmor:1.32.0@sha256:3014cc8f68f663935f69b3c3e0e41f5ce102b268d97db13db0f62208747f860d AS zizmor
FROM hadolint/hadolint:v2.15.1@sha256:32dac94127fd60b7b7e3fbfc65e1383b9b5e25c9bfd7b8536de7a539fe68a12d AS hadolint
FROM ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f AS gitleaks
FROM anchore/grype:v0.121.3@sha256:13113eeceab017260370cf540e1d25442c59665fd07d1b09b66d63bb0c282887 AS grype
FROM ghcr.io/zaproxy/zaproxy:2.16.1@sha256:7840969c7c9fead565bf9734b12f49f6886db90b1d35b1f74d79710bbd081dab AS zap
# Never built. ci.yml's Postgres services and the publish jobs' BuildKit
# repeat these two references; tests/repo/workflow-hardening.test.ts fails
# until they match.
FROM postgres:16.15-alpine@sha256:aa6cb33cf4c19c765cefcf48d96176258800870a9a1e930ad126200f9d825139 AS postgres
FROM moby/buildkit:v0.35.0@sha256:aa632b921ef07411d2cb77292cd34213d4f7b384001d6fceef1e1f25bf9752bb AS buildkit
