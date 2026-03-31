import { Bug, Lightbulb, HelpCircle, Shield, Users } from "lucide-react"

export interface ContactCategory {
  id: string
  label: string
  icon: typeof Bug
  desc: string
}

export interface StaffRole {
  id: string
  label: string
  desc: string
}

export const CATEGORIES: ContactCategory[] = [
  { id: "bug", label: "Bug Report", icon: Bug, desc: "Something is broken or not working as expected" },
  { id: "feature", label: "Feature Request", icon: Lightbulb, desc: "Suggest a new feature or improvement" },
  { id: "security", label: "Security Issue", icon: Shield, desc: "Report a security vulnerability" },
  { id: "help", label: "General Help", icon: HelpCircle, desc: "Need help using VulnRadar" },
  { id: "staff_application", label: "Apply for Staff", icon: Users, desc: "Join the VulnRadar team" },
]

export const STAFF_ROLES: StaffRole[] = [
  { id: "support", label: "Support", desc: "Help users with technical issues and questions" },
  { id: "moderator", label: "Moderator", desc: "Enforce policies and maintain community standards" },
]
