import {
  Bug,
  Lightbulb,
  HelpCircle,
  Shield,
  Users,
  CreditCard,
  Building2,
  MessageSquare,
} from "lucide-react";
import { APP_NAME } from "@/lib/config/constants";

export interface ContactCategory {
  id: string;
  label: string;
  icon: typeof Bug;
  desc: string;
}

export interface StaffRole {
  id: string;
  label: string;
  desc: string;
}

export const CATEGORIES: ContactCategory[] = [
  {
    id: "bug",
    label: "Bug Report",
    icon: Bug,
    desc: "Something is broken or not working",
  },
  {
    id: "feature",
    label: "Feature Request",
    icon: Lightbulb,
    desc: "Suggest a new feature or improvement",
  },
  {
    id: "security",
    label: "Security Issue",
    icon: Shield,
    desc: "Report a vulnerability responsibly",
  },
  {
    id: "help",
    label: "General Help",
    icon: HelpCircle,
    desc: `Need help using ${APP_NAME}`,
  },
  {
    id: "billing",
    label: "Billing Issue",
    icon: CreditCard,
    desc: "Payment or subscription help",
  },
  {
    id: "enterprise",
    label: "Enterprise",
    icon: Building2,
    desc: "Team plans & partnerships",
  },
  {
    id: "staff_application",
    label: "Apply for Staff",
    icon: Users,
    desc: `Join the ${APP_NAME} team`,
  },
  {
    id: "feedback",
    label: "Feedback",
    icon: MessageSquare,
    desc: "Share your thoughts with us",
  },
];

export const STAFF_ROLES: StaffRole[] = [
  {
    id: "support",
    label: "Support Agent",
    desc: "Help users with technical issues and questions",
  },
  {
    id: "moderator",
    label: "Community Moderator",
    desc: "Enforce policies and maintain community standards",
  },
  {
    id: "content",
    label: "Content Creator",
    desc: "Create tutorials, docs, and educational content",
  },
  {
    id: "beta_tester",
    label: "Beta Tester",
    desc: "Test new features before release",
  },
];
