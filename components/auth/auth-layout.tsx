import Link from "next/link";
import { ThemedLogo } from "@/components/shared/themed-logo";
import { APP_NAME } from "@/lib/config/constants";

interface AuthLayoutProps {
  children: React.ReactNode;
}

export function AuthLayout({ children }: AuthLayoutProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-[360px]">
        <Link href="/" className="inline-flex items-center gap-2 mb-10 group">
          <ThemedLogo
            width={22}
            height={22}
            className="h-[22px] w-[22px] shrink-0 transition-transform duration-150 group-hover:scale-105"
            alt={`${APP_NAME} logo`}
          />
          <span className="font-mono text-base font-semibold tracking-tight text-foreground">
            {APP_NAME}
          </span>
        </Link>
        {children}
      </div>
    </div>
  );
}
