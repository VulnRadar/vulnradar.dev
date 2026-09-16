import { describe, it, expect } from "vitest";
import {
  detectLibrary,
  libraryComponent,
  versionBelow,
} from "@/lib/scanner/library-fingerprints";

describe("detectLibrary", () => {
  it.each([
    ["https://code.jquery.com/jquery-1.12.4.min.js", "jquery@1.12.4"],
    [
      "https://cdn.jsdelivr.net/npm/jquery@1.12.4/dist/jquery.min.js",
      "jquery@1.12.4",
    ],
    // cdnjs puts the version in a directory, which neither old copy read.
    [
      "https://cdnjs.cloudflare.com/ajax/libs/jquery/3.4.1/jquery.min.js",
      "jquery@3.4.1",
    ],
    [
      "https://cdnjs.cloudflare.com/ajax/libs/lodash.js/4.17.15/lodash.min.js",
      "lodash@4.17.15",
    ],
    [
      "https://cdnjs.cloudflare.com/ajax/libs/moment.js/2.29.1/moment.min.js",
      "moment@2.29.1",
    ],
    [
      "https://cdnjs.cloudflare.com/ajax/libs/jqueryui/1.12.1/jquery-ui.min.js",
      "jquery-ui@1.12.1",
    ],
    ["https://code.jquery.com/ui/1.12.1/jquery-ui.min.js", null],
    [
      "https://unpkg.com/react@18.2.0/umd/react.production.min.js",
      "react@18.2.0",
    ],
    [
      "https://cdnjs.cloudflare.com/ajax/libs/prism/1.25.0/prism.min.js",
      "prismjs@1.25.0",
    ],
    [
      "https://cdn.jsdelivr.net/npm/dompurify@2.3.6/dist/purify.min.js",
      "dompurify@2.3.6",
    ],
    // WordPress core versions its bundled libraries with ?ver=.
    [
      "https://example.com/wp-includes/js/jquery/jquery.js?ver=1.12.4-wp",
      "jquery@1.12.4",
    ],
    [
      "https://example.com/wp-includes/js/dist/vendor/lodash.min.js?ver=4.17.19",
      "lodash@4.17.19",
    ],
    // A package pinned by the CDN URL whose file is not named after it.
    [
      "https://cdn.jsdelivr.net/npm/alpinejs@3.10.0/dist/cdn.min.js",
      "alpinejs@3.10.0",
    ],
    [
      "https://cdnjs.cloudflare.com/ajax/libs/alpinejs/3.10.0/cdn.min.js",
      "alpinejs@3.10.0",
    ],
  ])("reads %s as %s", (url, expected) => {
    const lib = detectLibrary(url);
    expect(lib ? libraryComponent(lib) : null).toBe(expected);
  });

  it.each([
    // momentum.js is not Moment.js.
    "/vendor/momentum-1.2.3.min.js",
    "https://unpkg.com/react-dom@18.2.0/umd/react-dom.production.min.js",
    "https://cdn.jsdelivr.net/npm/bootstrap-datepicker@1.9.0/dist/js/bootstrap-datepicker.min.js",
    "/wp-includes/js/jquery/jquery-migrate.min.js?ver=3.3.2",
    "/vendor/jquery.js",
    // A directory named after a library is not the library.
    "https://example.com/assets/bootstrap/3.2.0/init.js",
    "https://example.com/static/libs/prism/1.20.0/theme.js",
    // ?ver= outside WordPress core is a plugin's version or a cache key.
    "https://example.com/wp-content/plugins/x/js/bootstrap.min.js?ver=2.3.1",
    "https://example.com/js/jquery.min.js?ver=1.2.3",
  ])("does not claim a library and version for %s", (url) => {
    expect(detectLibrary(url)).toBeNull();
  });

  it("does not read jQuery UI as jQuery", () => {
    expect(
      detectLibrary(
        "https://cdn.jsdelivr.net/npm/jquery-ui@1.13.2/dist/jquery-ui.min.js",
      )?.npmPackage,
    ).toBe("jquery-ui");
  });
});

describe("versionBelow", () => {
  it("compares numerically, not as strings", () => {
    expect(versionBelow("1.9.0", "1.12.0")).toBe(true);
    expect(versionBelow("1.12.0", "1.9.0")).toBe(false);
    expect(versionBelow("3.5.0", "3.5.0")).toBe(false);
    expect(versionBelow("4.17", "4.17.21")).toBe(true);
  });

  it("sorts a prerelease below the release it leads to", () => {
    expect(versionBelow("1.2.3-beta.1", "1.2.3")).toBe(true);
    expect(versionBelow("2.0.0", "2.0.0-rc.1")).toBe(false);
    expect(versionBelow("2.0.0-rc.1", "2.0.0-rc.2")).toBe(true);
    expect(versionBelow("2.0.0-rc.10", "2.0.0-rc.9")).toBe(false);
    expect(versionBelow("1.0.0-alpha", "1.0.0-alpha.1")).toBe(true);
    expect(versionBelow("1.0.0-1", "1.0.0-alpha")).toBe(true);
    expect(versionBelow("1.2.3+build.5", "1.2.3")).toBe(false);
  });

  it("ignores a leading v", () => {
    expect(versionBelow("v1.2.3", "1.0.0")).toBe(false);
    expect(versionBelow("v1.2.3", "v1.2.4")).toBe(true);
  });
});
