import { describe } from "vitest";
import { libraryChecks } from "@/lib/scanner/checks/page-checks/libraries";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-outdated-vulnerable-library": [
    {
      description: "jQuery 1.12.4 is below the fixed version",
      body: `<script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "CVE-2020-11022",
    },
    {
      description: "jQuery 3.6.0 is patched",
      body: `<script src="https://code.jquery.com/jquery-3.6.0.min.js"></script>`,
      expect: "skip",
    },
    {
      description: "Lodash 4.17.15 is vulnerable",
      body: `<script src="/vendor/lodash-4.17.15.min.js"></script>`,
      expect: "fire",
      evidenceIncludes: "lodash",
    },
    {
      description: "unversioned script filename is not evaluated",
      body: `<script src="/vendor/jquery.js"></script>`,
      expect: "skip",
    },
  ],
  "page-angularjs-legacy-detected": [
    {
      description: "AngularJS 1.x script filename",
      body: `<script src="https://ajax.googleapis.com/ajax/libs/angularjs/1.7.9/angular.min.js"></script>`,
      expect: "fire",
    },
    {
      description: "modern Angular (2+) is not flagged",
      body: `<script src="https://cdn.example.com/angular/17.0.0/angular.js"></script>`,
      expect: "skip",
    },
    {
      description: "no angular script present",
      body: `<script src="/app.js"></script>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/libraries", () => {
  runPageCheckTests(libraryChecks, fixtures);
});
