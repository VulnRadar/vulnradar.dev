import { APP_NAME, APP_REPO } from "@/lib/config/constants";

export function DemoInfo() {
  return (
    <section className="border-t border-border/50 py-16 sm:py-20">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-6 text-balance">
          Why we let you scan us
        </h2>

        <div className="space-y-5 text-muted-foreground leading-relaxed text-[15px] sm:text-base">
          <p>
            A security tool that will not run its own checks on itself is asking
            you to take a lot on faith. So the demo target is this deployment,
            live, with the same check set and the same severity rules any other
            URL gets.
          </p>
          <p>
            Sometimes it finds things. When it does, they are in the report you
            are about to see, not quietly suppressed. Findings on our own
            infrastructure get filed as issues in{" "}
            <a
              href={`https://github.com/${APP_REPO}`}
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline underline-offset-4 rounded-sm focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
            >
              the public repo
            </a>{" "}
            like everything else.
          </p>
        </div>

        <blockquote className="mt-8 border-l-2 border-primary pl-5 sm:pl-6">
          <p className="text-lg font-medium tracking-tight text-foreground text-balance">
            If {APP_NAME} says a header is missing here, it is genuinely
            missing. You can check the response yourself.
          </p>
        </blockquote>
      </div>
    </section>
  );
}
