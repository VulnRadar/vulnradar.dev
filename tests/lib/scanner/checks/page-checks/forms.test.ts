import { describe } from "vitest";
import { formChecks } from "@/lib/scanner/checks/page-checks/forms";
import { runPageCheckTests, type PageCheckFixtures } from "./_test-harness";

const fixtures: PageCheckFixtures = {
  "page-form-password-over-http": [
    {
      description: "password field posts to an http:// action on an https page",
      url: "https://example.com/login",
      body: `<form action="http://example.com/submit" method="post"><input type="password" name="pw"></form>`,
      expect: "fire",
      evidenceIncludes: "http",
    },
    {
      description: "password field posts over https",
      url: "https://example.com/login",
      body: `<form action="https://example.com/submit" method="post"><input type="password" name="pw"></form>`,
      expect: "skip",
    },
    {
      description: "form has no password field",
      url: "https://example.com/",
      body: `<form action="http://example.com/submit" method="post"><input type="text" name="q"></form>`,
      expect: "skip",
    },
  ],
  "page-form-missing-csrf-token": [
    {
      description: "POST form with no hidden csrf-shaped field",
      body: `<form action="/save" method="post"><input type="text" name="name"></form>`,
      expect: "fire",
    },
    {
      description: "POST form with a csrf token field",
      body: `<form action="/save" method="post"><input type="hidden" name="csrf_token" value="x"><input type="text" name="name"></form>`,
      expect: "skip",
    },
    {
      description: "GET form is not state-changing",
      body: `<form action="/search" method="get"><input type="text" name="q"></form>`,
      expect: "skip",
    },
  ],
  "page-form-cross-origin-action": [
    {
      description: "non-password form posts to a third-party origin",
      url: "https://example.com/",
      body: `<form action="https://payments.example.net/charge" method="post"><input name="amount"></form>`,
      expect: "fire",
      evidenceIncludes: "third-party",
    },
    {
      description: "form posts to the same origin",
      url: "https://example.com/",
      body: `<form action="/save" method="post"><input name="amount"></form>`,
      expect: "skip",
    },
  ],
  "page-password-field-autocomplete-wrong": [
    {
      description: "password field with no autocomplete attribute",
      body: `<form><input type="password" name="pw"></form>`,
      expect: "fire",
    },
    {
      description: "password field with autocomplete=current-password",
      body: `<form><input type="password" name="pw" autocomplete="current-password"></form>`,
      expect: "skip",
    },
    {
      description: "password field with autocomplete=new-password",
      body: `<form><input type="password" name="pw" autocomplete="new-password"></form>`,
      expect: "skip",
    },
  ],
  "page-form-password-cross-origin": [
    {
      description: "password field posts to a third-party origin",
      url: "https://example.com/login",
      body: `<form action="https://auth.other.net/login" method="post"><input type="password" name="pw"></form>`,
      expect: "fire",
      evidenceIncludes: "third-party",
    },
    {
      description: "password field posts to the same origin",
      url: "https://example.com/login",
      body: `<form action="/login" method="post"><input type="password" name="pw"></form>`,
      expect: "skip",
    },
    {
      description: "cross-origin form without a password field",
      url: "https://example.com/",
      body: `<form action="https://payments.example.net/charge" method="post"><input name="amount"></form>`,
      expect: "skip",
    },
  ],
};

describe("page-checks/forms", () => {
  runPageCheckTests(formChecks, fixtures);
});
