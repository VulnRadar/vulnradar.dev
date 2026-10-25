"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { LazyMount } from "@/components/shared/lazy-mount";

const loadBackupCodesModal = () =>
  import("@/components/shared/backup-codes-modal").then(
    (mod) => mod.BackupCodesModal,
  );

/**
 * Mounts the backup-code reminder only for an account that needs it.
 *
 * The modal itself still decides whether to show (not on a public route, not
 * after "Remind me later"); this only decides whether its code is worth
 * downloading at all, which is a question about the account and nothing else.
 */
export function BackupCodesMount() {
  const { me } = useAuth();
  return (
    <LazyMount
      wanted={Boolean(me?.userId && me.backupCodesInvalid)}
      load={loadBackupCodesModal}
    />
  );
}
