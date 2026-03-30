"use client"

import { useState, useRef } from "react"
import { Camera, Loader2, Trash2, Check, X, User, Mail, Calendar, Shield, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { useProfile } from "../profile-context"
import { formatDate } from "../profile-types"

export function ProfileGeneralTab() {
  const { profile, updateProfile, uploadAvatar, deleteAvatar } = useProfile()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [isEditing, setIsEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false)
  
  const [formData, setFormData] = useState({
    name: profile?.name || "",
    bio: profile?.bio || "",
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
      name: profile?.name || "",
      bio: profile?.bio || "",
      website: profile?.website || "",
    })
    setIsEditing(false)
  }

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file
    if (!file.type.startsWith("image/")) {
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      return
    }

    setIsUploadingAvatar(true)
    await uploadAvatar(file)
    setIsUploadingAvatar(false)
  }

  const handleDeleteAvatar = async () => {
    setIsUploadingAvatar(true)
    await deleteAvatar()
    setIsUploadingAvatar(false)
  }

  if (!profile) return null

  const initials = profile.name
    ? profile.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : profile.email?.charAt(0).toUpperCase() || "U"

  return (
    <div className="space-y-6">
      {/* Avatar Section */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="relative">
            <Avatar className="h-20 w-20 sm:h-24 sm:w-24">
              <AvatarImage src={profile.avatar || undefined} alt={profile.name} />
              <AvatarFallback className="text-xl sm:text-2xl bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            {isUploadingAvatar && (
              <div className="absolute inset-0 flex items-center justify-center bg-background/80 rounded-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium text-foreground mb-1">Profile Photo</h3>
            <p className="text-xs text-muted-foreground mb-3">
              JPG, PNG or GIF. Max 5MB.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleAvatarChange}
                className="hidden"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isUploadingAvatar}
              >
                <Camera className="h-3.5 w-3.5 mr-1.5" />
                Upload
              </Button>
              {profile.avatar && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteAvatar}
                  disabled={isUploadingAvatar}
                  className="text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Remove
                </Button>
              )}
            </div>
          </div>
        </div>
      </Card>

      {/* Profile Info */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-foreground">Profile Information</h3>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="name" className="text-xs">Display Name</Label>
              {isEditing ? (
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Enter your name"
                  className="bg-background"
                />
              ) : (
                <p className="text-sm text-foreground">{profile.name || "Not set"}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs">Email</Label>
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">{profile.email}</p>
                {profile.emailVerified && (
                  <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10 text-[10px]">
                    Verified
                  </Badge>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="website" className="text-xs">Website</Label>
            {isEditing ? (
              <Input
                id="website"
                value={formData.website}
                onChange={(e) => setFormData({ ...formData, website: e.target.value })}
                placeholder="https://example.com"
                className="bg-background"
              />
            ) : (
              <p className="text-sm text-foreground">
                {profile.website ? (
                  <a href={profile.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                    {profile.website}
                  </a>
                ) : (
                  "Not set"
                )}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="bio" className="text-xs">Bio</Label>
            {isEditing ? (
              <Textarea
                id="bio"
                value={formData.bio}
                onChange={(e) => setFormData({ ...formData, bio: e.target.value })}
                placeholder="Tell us about yourself"
                rows={3}
                className="bg-background resize-none"
              />
            ) : (
              <p className="text-sm text-muted-foreground">{profile.bio || "No bio added yet"}</p>
            )}
          </div>
        </div>
      </Card>

      {/* Account Stats */}
      <Card className="p-4 sm:p-6 border-border/50 bg-card/50">
        <h3 className="text-sm font-medium text-foreground mb-4">Account Overview</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <User className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Role</p>
              <p className="text-sm font-medium text-foreground capitalize">{profile.role || "User"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <BarChart3 className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Scans</p>
              <p className="text-sm font-medium text-foreground">{profile.scanCount || 0}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Shield className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Plan</p>
              <p className="text-sm font-medium text-foreground capitalize">{profile.plan || "Free"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Calendar className="h-4 w-4 text-primary" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Joined</p>
              <p className="text-sm font-medium text-foreground">{formatDate(profile.createdAt)}</p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
}
