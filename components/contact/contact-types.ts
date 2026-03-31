import { 
  Bug, 
  Lightbulb, 
  HelpCircle, 
  Shield, 
  Users, 
  CreditCard, 
  Key, 
  Trash2, 
  Building2, 
  Megaphone, 
  Scale, 
  FileText, 
  Zap,
  Globe,
  Heart,
  MessageSquare
} from "lucide-react"

export interface ContactCategory {
  id: string
  label: string
  icon: typeof Bug
  desc: string
  group: "support" | "account" | "business" | "community"
}

export interface StaffRole {
  id: string
  label: string
  desc: string
}

export const CATEGORY_GROUPS = {
  support: { label: "Support", desc: "Get help with issues" },
  account: { label: "Account", desc: "Manage your account" },
  business: { label: "Business", desc: "Enterprise & partnerships" },
  community: { label: "Community", desc: "Get involved" },
} as const

export const CATEGORIES: ContactCategory[] = [
  // Support
  { id: "bug", label: "Bug Report", icon: Bug, desc: "Something is broken or not working", group: "support" },
  { id: "feature", label: "Feature Request", icon: Lightbulb, desc: "Suggest a new feature", group: "support" },
  { id: "security", label: "Security Issue", icon: Shield, desc: "Report a vulnerability", group: "support" },
  { id: "help", label: "General Help", icon: HelpCircle, desc: "Need help using VulnRadar", group: "support" },
  { id: "api", label: "API Support", icon: Key, desc: "API integration help", group: "support" },
  { id: "performance", label: "Performance Issue", icon: Zap, desc: "Slow or unresponsive scans", group: "support" },
  
  // Account
  { id: "billing", label: "Billing Issue", icon: CreditCard, desc: "Payment or subscription help", group: "account" },
  { id: "account_recovery", label: "Account Recovery", icon: Users, desc: "Can't access your account", group: "account" },
  { id: "data_request", label: "Data Request", icon: FileText, desc: "GDPR/data export requests", group: "account" },
  { id: "account_deletion", label: "Delete Account", icon: Trash2, desc: "Request account removal", group: "account" },
  
  // Business
  { id: "enterprise", label: "Enterprise Sales", icon: Building2, desc: "Team & enterprise plans", group: "business" },
  { id: "partnership", label: "Partnership", icon: Heart, desc: "Become a partner", group: "business" },
  { id: "media", label: "Media Inquiry", icon: Megaphone, desc: "Press & media requests", group: "business" },
  { id: "legal", label: "Legal", icon: Scale, desc: "Legal or compliance questions", group: "business" },
  { id: "reseller", label: "Reseller Program", icon: Globe, desc: "Become a reseller", group: "business" },
  
  // Community
  { id: "staff_application", label: "Apply for Staff", icon: Users, desc: "Join the VulnRadar team", group: "community" },
  { id: "feedback", label: "General Feedback", icon: MessageSquare, desc: "Share your thoughts", group: "community" },
]

export const STAFF_ROLES: StaffRole[] = [
  { id: "support", label: "Support Agent", desc: "Help users with technical issues and questions" },
  { id: "moderator", label: "Community Moderator", desc: "Enforce policies and maintain community standards" },
  { id: "content", label: "Content Creator", desc: "Create tutorials, docs, and educational content" },
  { id: "security_researcher", label: "Security Researcher", desc: "Help identify and report vulnerabilities" },
  { id: "translator", label: "Translator", desc: "Help translate VulnRadar to other languages" },
  { id: "beta_tester", label: "Beta Tester", desc: "Test new features before release" },
]
