import { ConversationRouteSkeleton } from "@/components/admin/ai-chats/conversation-skeleton";

/**
 * Without this file the segment inherited app/admin/loading.tsx, which draws
 * the admin console rather than a transcript, so opening a conversation showed
 * the console shape before the page it was actually navigating to.
 */
export default function Loading() {
  return <ConversationRouteSkeleton />;
}
