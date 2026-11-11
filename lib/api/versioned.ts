// The import route handlers use for versioned().
//
// The wrapper lives under lib/api/v4/, and any specifier that spells that path
// ("@/lib/api/v4/wrap", or a relative one that climbs to it) is a string
// containing an API path, which tests/repo/no-api-version-literals.test.ts
// rejects outside its home files. Re-exporting from here keeps the specifier
// free of it, so a route file has one line to import and nothing to list.
export { versioned } from "./v4/wrap";
