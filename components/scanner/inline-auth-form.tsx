"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ChevronDown, Eye, EyeOff, KeyRound, Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/ui/utils";
import { SCAN_AUTH } from "@/lib/config/constants";
import type { EphemeralAuthInput } from "@/lib/scanner/auth/types";

/**
 * The exact shape POST /api/v3/scan/authenticated expects in its `auth`
 * field (see lib/scanner/auth/types.ts). Re-exported under a form-facing
 * name so scan-form.tsx and app/dashboard/page.tsx don't need to reach into
 * the scanner internals directly, they only need to know the request shape.
 */
export type InlineAuthValue = EphemeralAuthInput;

type InlineAuthMethod = InlineAuthValue["method"];

export interface InlineAuthFormHandle {
  /**
   * Collapses the section and wipes every field back to its initial,
   * empty state. Called by the scan form the instant a scan is submitted,
   * so login material never lingers in this component past the one
   * request it was entered for.
   */
  reset: () => void;
}

interface InlineAuthFormProps {
  disabled?: boolean;
  /** Fires with the built auth payload whenever the section is open and
   *  has enough filled in to be usable, and with null the rest of the
   *  time (collapsed, method incomplete, or just reset). */
  onChange: (value: InlineAuthValue | null) => void;
}

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

const FIELD_CLASS = cn(
  "h-9 border-border bg-background text-base sm:text-sm",
  FOCUS_RING,
);

const LABEL_CLASS = "text-xs font-medium text-foreground";

const METHODS: { id: InlineAuthMethod; label: string }[] = [
  { id: "form", label: "Form login" },
  { id: "header", label: "Header / token" },
  { id: "cookie", label: "Cookie" },
];

interface CookieRow {
  id: number;
  name: string;
  value: string;
  show: boolean;
}

function emptyCookieRow(id: number): CookieRow {
  return { id, name: "", value: "", show: false };
}

function RevealButton({
  shown,
  onToggle,
  disabled,
  label,
}: {
  shown: boolean;
  onToggle: () => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      className={cn(
        "absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
        FOCUS_RING,
      )}
      aria-label={shown ? `Hide ${label}` : `Show ${label}`}
      aria-pressed={shown}
    >
      {shown ? (
        <EyeOff className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Eye className="h-3.5 w-3.5" aria-hidden />
      )}
    </button>
  );
}

export const InlineAuthForm = forwardRef<
  InlineAuthFormHandle,
  InlineAuthFormProps
>(function InlineAuthForm({ disabled, onChange }, ref) {
  const idPrefix = useId();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<InlineAuthMethod>("form");

  // Form method fields.
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [loginUrl, setLoginUrl] = useState("");
  const [usernameField, setUsernameField] = useState("");
  const [passwordField, setPasswordField] = useState("");

  // Header method fields.
  const [headerName, setHeaderName] = useState("Authorization");
  const [headerValue, setHeaderValue] = useState("");
  const [showHeaderValue, setShowHeaderValue] = useState(false);

  // Cookie method fields. Row ids only ever increment from user clicks on
  // "Add another cookie", so the very first render (server and client
  // alike) is always the same single row with id 0, no hydration drift.
  const [cookies, setCookies] = useState<CookieRow[]>(() => [
    emptyCookieRow(0),
  ]);
  const nextCookieId = useRef(1);

  function resetAll() {
    setMethod("form");
    setUsername("");
    setPassword("");
    setShowPassword(false);
    setAdvancedOpen(false);
    setLoginUrl("");
    setUsernameField("");
    setPasswordField("");
    setHeaderName("Authorization");
    setHeaderValue("");
    setShowHeaderValue(false);
    setCookies([emptyCookieRow(0)]);
    nextCookieId.current = 1;
  }

  useImperativeHandle(ref, () => ({
    reset() {
      setOpen(false);
      resetAll();
    },
  }));

  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      // Collapsing wipes every field immediately. Nothing typed into this
      // section outlives the section being open, not even in memory.
      if (!next) resetAll();
      return next;
    });
  }

  useEffect(() => {
    if (!open) {
      onChange(null);
      return;
    }
    if (method === "form") {
      const trimmedUser = username.trim();
      if (!trimmedUser || !password) {
        onChange(null);
        return;
      }
      const trimmedLoginUrl = loginUrl.trim();
      const trimmedUsernameField = usernameField.trim();
      const trimmedPasswordField = passwordField.trim();
      onChange({
        method: "form",
        username: trimmedUser,
        password,
        ...(trimmedLoginUrl ? { loginUrl: trimmedLoginUrl } : {}),
        ...(trimmedUsernameField
          ? { usernameField: trimmedUsernameField }
          : {}),
        ...(trimmedPasswordField
          ? { passwordField: trimmedPasswordField }
          : {}),
      });
      return;
    }
    if (method === "header") {
      if (!headerValue) {
        onChange(null);
        return;
      }
      const trimmedName = headerName.trim();
      onChange({
        method: "header",
        ...(trimmedName ? { headerName: trimmedName } : {}),
        headerValue,
      });
      return;
    }
    const validCookies = cookies
      .map((c) => ({ name: c.name.trim(), value: c.value }))
      .filter((c) => c.name && c.value);
    if (validCookies.length === 0) {
      onChange(null);
      return;
    }
    onChange({ method: "cookie", cookies: validCookies });
  }, [
    open,
    method,
    username,
    password,
    loginUrl,
    usernameField,
    passwordField,
    headerName,
    headerValue,
    cookies,
    onChange,
  ]);

  function addCookieRow() {
    setCookies((prev) => {
      if (prev.length >= SCAN_AUTH.MAX_COOKIES) return prev;
      const row = emptyCookieRow(nextCookieId.current);
      nextCookieId.current += 1;
      return [...prev, row];
    });
  }

  function removeCookieRow(id: number) {
    setCookies((prev) =>
      prev.length <= 1 ? prev : prev.filter((c) => c.id !== id),
    );
  }

  function updateCookieRow(id: number, patch: Partial<CookieRow>) {
    setCookies((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  }

  if (!SCAN_AUTH.ENABLED) return null;

  return (
    <div className="border-t border-border">
      <button
        type="button"
        onClick={toggleOpen}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={`${idPrefix}-panel`}
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50",
          FOCUS_RING,
        )}
      >
        <KeyRound
          aria-hidden
          className="h-4 w-4 shrink-0 text-muted-foreground"
        />
        <span className="text-sm font-medium text-foreground">
          Sign in first
        </span>
        <span className="hidden text-xs text-muted-foreground sm:inline">
          Optional: scan the page as a logged-in user
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none",
            open && "rotate-180",
          )}
        />
      </button>

      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none",
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div id={`${idPrefix}-panel`} inert={!open} className="overflow-hidden">
          <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/20 px-3 pb-4 pt-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              Used once, for this scan only. It is never saved: not to this
              page, not to a draft, not anywhere, once you collapse this section
              or hit Scan.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {METHODS.map((m) => {
                const active = method === m.id;
                return (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setMethod(m.id)}
                    disabled={disabled}
                    aria-pressed={active}
                    className={cn(
                      "rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                      active
                        ? "bg-primary/10 text-primary"
                        : "bg-transparent text-muted-foreground hover:text-foreground",
                      FOCUS_RING,
                    )}
                  >
                    {m.label}
                  </button>
                );
              })}
            </div>

            {method === "form" && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`${idPrefix}-username`}
                      className={LABEL_CLASS}
                    >
                      Username or email
                    </Label>
                    <Input
                      id={`${idPrefix}-username`}
                      type="text"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      disabled={disabled}
                      className={FIELD_CLASS}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label
                      htmlFor={`${idPrefix}-password`}
                      className={LABEL_CLASS}
                    >
                      Password
                    </Label>
                    <div className="relative">
                      <Input
                        id={`${idPrefix}-password`}
                        type={showPassword ? "text" : "password"}
                        autoComplete="off"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        disabled={disabled}
                        className={cn(FIELD_CLASS, "pr-9")}
                      />
                      <RevealButton
                        shown={showPassword}
                        onToggle={() => setShowPassword((v) => !v)}
                        disabled={disabled}
                        label="password"
                      />
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/60 pt-2">
                  <button
                    type="button"
                    onClick={() => setAdvancedOpen((v) => !v)}
                    disabled={disabled}
                    aria-expanded={advancedOpen}
                    aria-controls={`${idPrefix}-advanced`}
                    className={cn(
                      "flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50",
                      FOCUS_RING,
                    )}
                  >
                    <ChevronDown
                      aria-hidden
                      className={cn(
                        "h-3 w-3 transition-transform duration-200 motion-reduce:transition-none",
                        advancedOpen && "rotate-180",
                      )}
                    />
                    Advanced: login URL and field names
                  </button>
                  {advancedOpen && (
                    <div
                      id={`${idPrefix}-advanced`}
                      className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-3"
                    >
                      <div className="flex flex-col gap-1.5">
                        <Label
                          htmlFor={`${idPrefix}-login-url`}
                          className={LABEL_CLASS}
                        >
                          Login page URL
                        </Label>
                        <Input
                          id={`${idPrefix}-login-url`}
                          type="url"
                          placeholder="https://example.com/login"
                          autoComplete="off"
                          value={loginUrl}
                          onChange={(e) => setLoginUrl(e.target.value)}
                          disabled={disabled}
                          className={FIELD_CLASS}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label
                          htmlFor={`${idPrefix}-username-field`}
                          className={LABEL_CLASS}
                        >
                          Username field name
                        </Label>
                        <Input
                          id={`${idPrefix}-username-field`}
                          type="text"
                          placeholder="Auto-detected"
                          autoComplete="off"
                          value={usernameField}
                          onChange={(e) => setUsernameField(e.target.value)}
                          disabled={disabled}
                          className={cn(FIELD_CLASS, "font-mono")}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label
                          htmlFor={`${idPrefix}-password-field`}
                          className={LABEL_CLASS}
                        >
                          Password field name
                        </Label>
                        <Input
                          id={`${idPrefix}-password-field`}
                          type="text"
                          placeholder="Auto-detected"
                          autoComplete="off"
                          value={passwordField}
                          onChange={(e) => setPasswordField(e.target.value)}
                          disabled={disabled}
                          className={cn(FIELD_CLASS, "font-mono")}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {method === "header" && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`${idPrefix}-header-name`}
                    className={LABEL_CLASS}
                  >
                    Header name
                  </Label>
                  <Input
                    id={`${idPrefix}-header-name`}
                    type="text"
                    autoComplete="off"
                    value={headerName}
                    onChange={(e) => setHeaderName(e.target.value)}
                    disabled={disabled}
                    className={cn(FIELD_CLASS, "font-mono")}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label
                    htmlFor={`${idPrefix}-header-value`}
                    className={LABEL_CLASS}
                  >
                    Header value
                  </Label>
                  <div className="relative">
                    <Input
                      id={`${idPrefix}-header-value`}
                      type={showHeaderValue ? "text" : "password"}
                      autoComplete="off"
                      placeholder="Bearer eyJ..."
                      value={headerValue}
                      onChange={(e) => setHeaderValue(e.target.value)}
                      disabled={disabled}
                      className={cn(FIELD_CLASS, "pr-9 font-mono")}
                    />
                    <RevealButton
                      shown={showHeaderValue}
                      onToggle={() => setShowHeaderValue((v) => !v)}
                      disabled={disabled}
                      label="header value"
                    />
                  </div>
                </div>
              </div>
            )}

            {method === "cookie" && (
              <div className="flex flex-col gap-2">
                {cookies.map((row, i) => (
                  <div key={row.id} className="flex items-end gap-1.5">
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label
                        htmlFor={`${idPrefix}-cookie-name-${row.id}`}
                        className={LABEL_CLASS}
                      >
                        {i === 0 ? "Cookie name" : `Cookie name ${i + 1}`}
                      </Label>
                      <Input
                        id={`${idPrefix}-cookie-name-${row.id}`}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        placeholder="session_id"
                        value={row.name}
                        onChange={(e) =>
                          updateCookieRow(row.id, { name: e.target.value })
                        }
                        disabled={disabled}
                        className={cn(FIELD_CLASS, "font-mono")}
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-1.5">
                      <Label
                        htmlFor={`${idPrefix}-cookie-value-${row.id}`}
                        className={LABEL_CLASS}
                      >
                        {i === 0 ? "Cookie value" : `Cookie value ${i + 1}`}
                      </Label>
                      <div className="relative">
                        <Input
                          id={`${idPrefix}-cookie-value-${row.id}`}
                          type={row.show ? "text" : "password"}
                          autoComplete="off"
                          value={row.value}
                          onChange={(e) =>
                            updateCookieRow(row.id, { value: e.target.value })
                          }
                          disabled={disabled}
                          className={cn(FIELD_CLASS, "pr-9 font-mono")}
                        />
                        <RevealButton
                          shown={row.show}
                          onToggle={() =>
                            updateCookieRow(row.id, { show: !row.show })
                          }
                          disabled={disabled}
                          label="cookie value"
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCookieRow(row.id)}
                      disabled={disabled || cookies.length <= 1}
                      aria-label="Remove this cookie"
                      className={cn(
                        "mb-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-30",
                        FOCUS_RING,
                      )}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={addCookieRow}
                  disabled={disabled || cookies.length >= SCAN_AUTH.MAX_COOKIES}
                  className={cn(
                    "inline-flex w-fit items-center gap-1.5 rounded px-2 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50",
                    FOCUS_RING,
                  )}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  Add another cookie
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
