"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Info } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { focus } from "@/lib/ui/animations";
import { cn } from "@/lib/ui/utils";
import {
  HINT_CLOSED,
  closesOnPageScroll,
  stepHint,
  type HintEvent,
  type HintState,
  type HintStep,
} from "./info-hint-state";

const PANEL_WIDTH = { sm: "w-64", md: "w-72", lg: "w-80" } as const;

export interface InfoHintProps {
  /** What the button is called to a screen reader. Name the thing explained:
   *  "About verified domains", not "More information". */
  label: string;
  /** The explanation. Text and inline formatting (strong, em, code) only: the
   *  panel is not focusable, so a link or button in it could not be reached. */
  children: ReactNode;
  size?: keyof typeof PANEL_WIDTH;
  side?: "top" | "bottom" | "left" | "right";
  align?: "start" | "center" | "end";
  /** Spacing and alignment against the neighbouring text. Not colour or size. */
  className?: string;
}

function focusIsVisible(el: HTMLElement): boolean {
  try {
    return el.matches(":focus-visible");
  } catch {
    return true;
  }
}

export function InfoHint({
  label,
  children,
  size = "md",
  side = "top",
  align = "center",
  className,
}: InfoHintProps) {
  const descriptionId = useId();
  const [state, setState] = useState<HintState>(HINT_CLOSED);
  const stateRef = useRef<HintState>(HINT_CLOSED);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const apply = useCallback((step: HintStep) => {
    stateRef.current = step.state;
    setState(step.state);
  }, []);

  const send = useCallback(
    (event: HintEvent) => {
      const step = stepHint(stateRef.current, event);
      apply(step);
      if (!step.timer) return;
      clearTimer();
      if (step.timer.kind === "cancel") return;
      const kind = step.timer.kind;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        apply(stepHint(stateRef.current, { type: "timer", kind }));
      }, step.timer.ms);
    },
    [apply, clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (!next) send({ type: "dismiss" });
    },
    [send],
  );

  return (
    <span className={cn("inline-flex shrink-0 align-middle", className)}>
      <Popover
        open={state.open}
        onOpenChange={onOpenChange}
        closeOnScroll={closesOnPageScroll(state)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={label}
            aria-describedby={descriptionId}
            aria-haspopup={undefined}
            onPointerEnter={(e) =>
              send({ type: "pointer-enter", pointerType: e.pointerType })
            }
            onPointerLeave={(e) =>
              send({ type: "pointer-leave", pointerType: e.pointerType })
            }
            onFocus={(e) =>
              send({
                type: "focus",
                focusVisible: focusIsVisible(e.currentTarget),
              })
            }
            onBlur={() => send({ type: "blur" })}
            onClick={(e) => {
              e.preventDefault();
              send({ type: "click", keyboard: e.detail === 0 });
            }}
            className={cn(
              "relative inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full",
              "text-muted-foreground transition-colors hover:text-foreground data-[state=open]:text-foreground",
              "pointer-coarse:after:absolute pointer-coarse:after:-inset-1.5 pointer-coarse:after:content-['']",
              focus.ring,
            )}
          >
            <Info aria-hidden className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          role="tooltip"
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            PANEL_WIDTH[size],
            "max-w-[calc(100vw-2rem)] rounded-lg p-3 text-xs leading-relaxed text-popover-foreground",
            "max-h-[var(--radix-popover-content-available-height)] overflow-y-auto",
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          onPointerEnter={() => send({ type: "content-enter" })}
          onPointerLeave={() => send({ type: "content-leave" })}
        >
          {children}
        </PopoverContent>
      </Popover>
      <span id={descriptionId} hidden>
        {children}
      </span>
    </span>
  );
}
