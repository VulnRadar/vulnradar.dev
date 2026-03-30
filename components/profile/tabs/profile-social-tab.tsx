"use client"

import { useState } from "react"
import { Twitter, Github, Linkedin, Globe, Loader2, Check, X, Link2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card } from "@/components/ui/card"
import { useProfile } from "../profile-context"

interface SocialLink {
  id: string
  label: string
  icon: typeof Twitter
  placeholder: string
  prefix: string
  key: "twitter" | "github" | "linkedin" | "website"
}

const SOCIAL_LINKS: SocialLink[] = [
  {
    id: "twitter",
    label: "Twitter",
    icon: Twitter,
    placeholder: "username",
    prefix: "twitter.com/",
    key: "twitter",
  },
  {
    id: "github",
    label: "GitHub",
    icon: Github,
    placeholder: "username",
    prefix: "github.com/",
    key: "github",
  },
  {
    id: "linkedin",
    label: "LinkedIn",
    icon: Linkedin,
    placeholder: "username",
    prefix: "linkedin.com/in/",
    key: "linkedin",
  },
  {
    id: "website",
    label: "Website",
    icon: Globe,
    placeholder: "https://example.com",
    prefix: "",
    key: "website",
  },
]

export function ProfileSocialTab() {
  const { profile, updateProfile } = useProfile()

  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  
  const [formData, setFormData] = useState({
    twitter: profile?.twitter || "",
    github: profile?.github || "",
    linkedin: profile?.linkedin || "",
    website: profile?.website || "",
  })

  const handleSave = async () => {
    setIsSaving(true)
    const success = await updateProfile(formData)
    if (success) {
      setIsEditing(false)
    }
    setIsSaving(false)
  }

  const handleCancel = () => {
    setFormData({
      twitter: profile?.twitter || "",
      github: profile?.github || "",
      linkedin: profile?.linkedin || "",
      website: profile?.website || "",
    })
    setIsEditing(false)
  }

  const getFullUrl = (link: SocialLink, value: string): string => {
    if (!value) return ""
    if (link.key === "website") return value
    return `https://${link.prefix}${value}`
  }

  return (
    <div className="space-y-6">
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Link2 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-foreground">Social Links</h3>
              <p className="text-xs text-muted-foreground">Connect your social profiles</p>
            </div>
          </div>
          {!isEditing ? (
            <Button variant="outline" size="sm" onClick={() => setIsEditing(true)}>
              Edit
            </Button>
          ) : (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={isSaving}>
                <X className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                ) : (
                  <Check className="h-3.5 w-3.5 mr-1" />
                )}
                Save
              </Button>
            </div>
          )}
        </div>

        <div className="space-y-4">
          {SOCIAL_LINKS.map((link) => {
            const Icon = link.icon
            const value = formData[link.key]
            const fullUrl = getFullUrl(link, value)

            return (
              <div key={link.id} className="space-y-2">
                <Label htmlFor={link.id} className="text-xs flex items-center gap-2">
                  <Icon className="h-3.5 w-3.5" />
                  {link.label}
                </Label>
                {isEditing ? (
                  <div className="flex items-center">
                    {link.prefix && (
                      <span className="px-3 py-2 text-xs text-muted-foreground bg-muted rounded-l-md border border-r-0 border-border">
                        {link.prefix}
                      </span>
                    )}
                    <Input
                      id={link.id}
                      value={value}
                      onChange={(e) => setFormData({ ...formData, [link.key]: e.target.value })}
                      placeholder={link.placeholder}
                      className={`bg-background ${link.prefix ? "rounded-l-none" : ""}`}
                    />
                  </div>
                ) : (
                  <p className="text-sm">
                    {value ? (
                      <a
                        href={fullUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        {link.key === "website" ? value : `${link.prefix}${value}`}
                      </a>
                    ) : (
                      <span className="text-muted-foreground">Not set</span>
                    )}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      </Card>

      {/* Preview Card */}
      {(formData.twitter || formData.github || formData.linkedin || formData.website) && (
        <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
          <h3 className="text-sm font-medium text-foreground mb-4">Preview</h3>
          <div className="flex flex-wrap gap-2">
            {formData.twitter && (
              <a
                href={`https://twitter.com/${formData.twitter}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm"
              >
                <Twitter className="h-4 w-4" />
                @{formData.twitter}
              </a>
            )}
            {formData.github && (
              <a
                href={`https://github.com/${formData.github}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm"
              >
                <Github className="h-4 w-4" />
                {formData.github}
              </a>
            )}
            {formData.linkedin && (
              <a
                href={`https://linkedin.com/in/${formData.linkedin}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm"
              >
                <Linkedin className="h-4 w-4" />
                {formData.linkedin}
              </a>
            )}
            {formData.website && (
              <a
                href={formData.website}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/50 hover:bg-muted transition-colors text-sm"
              >
                <Globe className="h-4 w-4" />
                {formData.website.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
        </Card>
      )}
    </div>
  )
}
