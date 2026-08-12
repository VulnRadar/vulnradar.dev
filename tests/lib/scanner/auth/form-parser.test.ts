import { describe, it, expect } from "vitest";
import {
  parseLoginForm,
  findLoginFormCandidates,
  hasPasswordInput,
  extractMetaCsrfToken,
  findAllForms,
} from "@/lib/scanner/auth/form-parser";

const DJANGO_LOGIN_FORM = `
<html><body>
<form method="post" action="/accounts/login/">
  <input type="hidden" name="csrfmiddlewaretoken" value="tok-django-123">
  <input type="text" name="username" placeholder="Username">
  <input type="password" name="password">
  <button type="submit">Log in</button>
</form>
</body></html>
`;

const RAILS_LOGIN_FORM = `
<html><head>
<meta name="csrf-token" content="rails-meta-token-abc">
</head><body>
<form action="/users/sign_in" method="post">
  <input type="hidden" name="authenticity_token" value="tok-rails-456">
  <input type="email" name="user[email]">
  <input type="password" name="user[password]">
  <input type="checkbox" name="user[remember_me]" value="1">
</form>
</body></html>
`;

const NO_FORM_PAGE = `<html><body><h1>Welcome</h1></body></html>`;

describe("parseLoginForm", () => {
  it("finds the identifier and password fields and carries the CSRF hidden field through", () => {
    const form = parseLoginForm(
      DJANGO_LOGIN_FORM,
      "https://app.example.com/accounts/login/",
    );
    expect(form).not.toBeNull();
    expect(form!.identifierField).toBe("username");
    expect(form!.secretField).toBe("password");
    expect(form!.hiddenFields).toEqual({
      csrfmiddlewaretoken: "tok-django-123",
    });
    expect(form!.action).toBe("https://app.example.com/accounts/login/");
    expect(form!.method).toBe("POST");
  });

  it("handles Rails-style bracketed field names and its hidden authenticity_token", () => {
    const form = parseLoginForm(
      RAILS_LOGIN_FORM,
      "https://app.example.com/users/sign_in",
    );
    expect(form).not.toBeNull();
    expect(form!.identifierField).toBe("user[email]");
    expect(form!.secretField).toBe("user[password]");
    expect(form!.hiddenFields).toEqual({ authenticity_token: "tok-rails-456" });
    // The checkbox must not be treated as a hidden field to replay.
    expect(form!.hiddenFields["user[remember_me]"]).toBeUndefined();
  });

  it("resolves a relative form action against the page URL", () => {
    const html = `<form action="do-login"><input type="password" name="p"><input type="text" name="u"></form>`;
    const form = parseLoginForm(html, "https://app.example.com/login/page");
    expect(form!.action).toBe("https://app.example.com/login/do-login");
  });

  it("respects configured field name overrides", () => {
    const html = `
      <form action="/login">
        <input type="text" name="login_id">
        <input type="text" name="decoy">
        <input type="password" name="pw">
      </form>`;
    const form = parseLoginForm(html, "https://app.example.com/login", {
      configuredIdentifier: "login_id",
      configuredSecret: "pw",
    });
    expect(form!.identifierField).toBe("login_id");
    expect(form!.secretField).toBe("pw");
  });

  it("returns null when there is no password field on the page", () => {
    expect(parseLoginForm(NO_FORM_PAGE, "https://app.example.com/")).toBeNull();
  });

  it("returns null when a password field exists but no usable identifier field does", () => {
    const html = `<form action="/login"><input type="password" name="password"></form>`;
    expect(parseLoginForm(html, "https://app.example.com/login")).toBeNull();
  });
});

describe("findLoginFormCandidates", () => {
  it("returns a single candidate for a page with one login form", () => {
    const candidates = findLoginFormCandidates(
      DJANGO_LOGIN_FORM,
      "https://app.example.com/accounts/login/",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].secretField).toBe("password");
  });

  it("returns one candidate per distinct password form on the page", () => {
    const html = `
      <form action="/login">
        <input type="text" name="username">
        <input type="password" name="password">
      </form>
      <form action="/admin-login">
        <input type="text" name="admin_user">
        <input type="password" name="admin_pass">
      </form>`;
    const candidates = findLoginFormCandidates(
      html,
      "https://app.example.com/",
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.action)).toEqual([
      "https://app.example.com/login",
      "https://app.example.com/admin-login",
    ]);
  });

  it("returns an empty array when no form has a resolvable password field", () => {
    expect(
      findLoginFormCandidates(NO_FORM_PAGE, "https://app.example.com/"),
    ).toEqual([]);
  });

  it("skips a form with a password field but no usable identifier, still reporting other candidates", () => {
    const html = `
      <form action="/broken"><input type="password" name="password"></form>
      <form action="/login">
        <input type="text" name="username">
        <input type="password" name="password">
      </form>`;
    const candidates = findLoginFormCandidates(
      html,
      "https://app.example.com/",
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0].action).toBe("https://app.example.com/login");
  });
});

describe("hasPasswordInput", () => {
  it("detects a password field", () => {
    expect(hasPasswordInput(DJANGO_LOGIN_FORM)).toBe(true);
  });

  it("returns false with no password field", () => {
    expect(hasPasswordInput(NO_FORM_PAGE)).toBe(false);
  });
});

describe("extractMetaCsrfToken", () => {
  it("reads a Rails-style csrf-token meta tag", () => {
    expect(extractMetaCsrfToken(RAILS_LOGIN_FORM)).toBe("rails-meta-token-abc");
  });

  it("returns null when no such meta tag exists", () => {
    expect(extractMetaCsrfToken(DJANGO_LOGIN_FORM)).toBeNull();
  });
});

const SEARCH_FORM = `
<html><body>
<form action="/search" method="get">
  <input type="text" name="q" placeholder="Search...">
  <button type="submit">Go</button>
</form>
</body></html>
`;

const CONTACT_FORM = `
<html><body>
<form action="/contact" method="post">
  <input type="hidden" name="csrf" value="tok-contact-789">
  <input type="text" name="name">
  <input type="email" name="email">
  <input type="tel" name="phone">
  <textarea name="message"></textarea>
  <input type="checkbox" name="subscribe">
  <button type="submit">Send</button>
</form>
</body></html>
`;

const MULTI_FORM_PAGE = `${SEARCH_FORM}${CONTACT_FORM}`;

describe("findAllForms", () => {
  it("finds a plain search form with no password field (not a findLoginFormCandidates candidate)", () => {
    expect(findLoginFormCandidates(SEARCH_FORM, "https://example.com")).toEqual(
      [],
    );
    const forms = findAllForms(SEARCH_FORM, "https://example.com");
    expect(forms).toHaveLength(1);
    expect(forms[0].method).toBe("GET");
    expect(forms[0].testableFields).toEqual(["q"]);
  });

  it("collects text/email/tel fields as testable and carries hidden fields through, excluding checkboxes", () => {
    const forms = findAllForms(CONTACT_FORM, "https://example.com");
    expect(forms).toHaveLength(1);
    expect(forms[0].action).toBe("https://example.com/contact");
    expect(forms[0].method).toBe("POST");
    expect(forms[0].hiddenFields).toEqual({ csrf: "tok-contact-789" });
    expect(forms[0].testableFields.sort()).toEqual(["email", "name", "phone"]);
    expect(forms[0].testableFields).not.toContain("subscribe");
  });

  it("finds every form on a page with more than one", () => {
    const forms = findAllForms(MULTI_FORM_PAGE, "https://example.com");
    expect(forms).toHaveLength(2);
  });

  it("still includes a login form (has password + identifier) with the password field excluded from testableFields", () => {
    const forms = findAllForms(DJANGO_LOGIN_FORM, "https://example.com");
    expect(forms).toHaveLength(1);
    expect(forms[0].testableFields).toEqual(["username"]);
    expect(forms[0].testableFields).not.toContain("password");
  });

  it("returns [] for a page with no forms", () => {
    expect(findAllForms(NO_FORM_PAGE, "https://example.com")).toEqual([]);
  });

  it("returns an empty testableFields array (not dropped) for a form with only a submit button", () => {
    const html = `<form action="/ping" method="post"><button type="submit">Ping</button></form>`;
    const forms = findAllForms(html, "https://example.com");
    expect(forms).toHaveLength(1);
    expect(forms[0].testableFields).toEqual([]);
  });
});
