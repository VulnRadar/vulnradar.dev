"use client"

import React, { useState, useRef, useEffect } from "react"
import Image from "next/image"
import {
  UserCog,
  Award,
  Mail,
  Pencil,
  X,
  Camera,
  Loader2,
  Zap,
  Lock,
  Share2,
  Tag,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { API } from "@/lib/config/constants"
import type { ProfileTabProps } from "../types"

interface ProfileGeneralTabProps extends ProfileTabProps {
  onAvatarCrop?: (croppedDataUrl: string) => void
  onSetCropDialog?: (open: boolean, imageSrc: string | null) => void
}

export function ProfileGeneralTab({
  user,
  setError,
  setSuccess,
  onTabChange,
  pendingChanges,
  setPendingChanges,
  discardKey,
  onAvatarCrop,
  onSetCropDialog,
}: ProfileGeneralTabProps) {
  const [profileEditMode, setProfileEditMode] = useState(false)
  const [nameInput, setNameInput] = useState(user?.name || "")
  const [emailInput, setEmailInput] = useState(user?.email || "")
  const [uploadingAvatar, setUploadingAvatar] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Reset inputs when user changes
  useEffect(() => {
    setNameInput(user?.name || "")
    setEmailInput(user?.email || "")
  }, [user])

  // Reset inputs when discard is clicked
  useEffect(() => {
    if (discardKey && discardKey > 0) {
      setNameInput(user?.name || "")
      setEmailInput(user?.email || "")
      setProfileEditMode(false)
    }
  }, [discardKey, user])

  function handleAvatarFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setError("Please select an image file.")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Image must be under 10MB.")
      return
    }
    setError(null)
    const isGif = file.type === "image/gif"
    if (isGif) {
      const reader = new FileReader()
      reader.onload = () => onAvatarCrop?.(reader.result as string)
      reader.readAsDataURL(file)
    } else {
      const reader = new FileReader()
      reader.onload = () => onSetCropDialog?.(true, reader.result as string)
      reader.readAsDataURL(file)
    }
    if (avatarInputRef.current) avatarInputRef.current.value = ""
  }

  async function handleRemoveAvatar() {
    setUploadingAvatar(true)
    setError(null)
    try {
      const res = await fetch(API.AUTH.UPDATE, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarUrl: "" }),
      })
      if (res.ok) {
        setSuccess("Profile picture removed.")
      }
    } catch {
      setError("Failed to remove profile picture.")
    } finally {
      setUploadingAvatar(false)
    }
  }

  function handleCancelEdit() {
    setNameInput(user?.name || "")
    setEmailInput(user?.email || "")
    setPendingChanges(prev => {
      const { name: _, email: __, ...rest } = prev
      return rest
    })
    setProfileEditMode(false)
  }

  function handleNameChange(val: string) {
    setNameInput(val)
    if (val !== (user?.name || "")) {
      setPendingChanges(prev => ({ ...prev, name: val }))
    } else {
      setPendingChanges(prev => {
        const { name: _, ...rest } = prev
        return rest
      })
    }
  }

  function handleEmailChange(val: string) {
    setEmailInput(val)
    if (val !== user?.email) {
      setPendingChanges(prev => ({ ...prev, email: val }))
    } else {
      setPendingChanges(prev => {
        const { email: _, ...rest } = prev
        return rest
      })
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* Personal Information */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <UserCog className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Personal Information</h2>
            <p className="text-sm text-muted-foreground">Manage your profile picture, name, and email</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6 flex flex-col gap-5">
            {/* Profile Picture */}
            <div className="flex flex-col gap-2">
              <Label className="text-sm font-medium text-muted-foreground">Profile Picture</Label>
              <div className="flex items-center gap-4">
                <div className="relative group">
                  <div className="h-16 w-16 rounded-full border-2 border-border bg-secondary/40 flex items-center justify-center overflow-hidden">
                    {user?.avatarUrl ? (
                      <Image src={user.avatarUrl} alt="Profile" width={64} height={64} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-xl font-bold text-muted-foreground">
                        {user?.name?.charAt(0)?.toUpperCase() || user?.email?.charAt(0)?.toUpperCase() || "?"}
                      </span>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => avatarInputRef.current?.click()}
                    disabled={uploadingAvatar}
                    className="absolute inset-0 flex items-center justify-center rounded-full bg-background/70 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="h-5 w-5 animate-spin text-foreground" />
                    ) : (
                      <Camera className="h-5 w-5 text-foreground" />
                    )}
                  </button>
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-transparent text-xs"
                      onClick={() => avatarInputRef.current?.click()}
                      disabled={uploadingAvatar}
                    >
                      {uploadingAvatar ? "Uploading..." : "Upload"}
                    </Button>
                    {user?.avatarUrl && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-destructive hover:text-destructive"
                        onClick={handleRemoveAvatar}
                        disabled={uploadingAvatar}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground">JPG, PNG, or GIF. Max 10MB.</p>
                </div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarFileSelect}
                  className="hidden"
                />
              </div>
            </div>

            {/* Badges section */}
            {user?.badges && user.badges.length > 0 && (
              <div className="flex flex-col gap-2">
                <Label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  <Award className="h-4 w-4" /> Badges
                </Label>
                <div className="flex flex-wrap gap-2 p-3 rounded-lg border border-border bg-secondary/20">
                  {user.badges.map((badge) => (
                    <div
                      key={badge.id}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium"
                      style={{
                        backgroundColor: `${badge.color}15`,
                        borderWidth: 1,
                        borderColor: `${badge.color}40`,
                        color: badge.color || undefined,
                      }}
                      title={badge.description || undefined}
                    >
                      <Tag className="h-3 w-3" />
                      {badge.display_name}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Name + Email with edit mode toggle */}
            <div className="flex items-center justify-between mb-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Personal Details</p>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => profileEditMode ? handleCancelEdit() : setProfileEditMode(true)}
              >
                {profileEditMode ? (
                  <><X className="h-3 w-3" />Cancel</>
                ) : (
                  <><Pencil className="h-3 w-3" />Edit</>
                )}
              </Button>
            </div>

            {!profileEditMode ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <UserCog className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground font-medium">Display Name</span>
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">
                    {user?.name || <span className="text-muted-foreground italic">Not set</span>}
                  </span>
                </div>
                <div className="flex flex-col gap-1 p-3 rounded-lg border bg-muted/20 border-border">
                  <div className="flex items-center gap-2 mb-1">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground font-medium">Email Address</span>
                  </div>
                  <span className="text-sm font-medium text-foreground truncate">{user?.email}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">Display Name</Label>
                    {pendingChanges.name !== undefined && pendingChanges.name !== (user?.name || "") && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">Modified</Badge>
                    )}
                  </div>
                  <Input
                    value={nameInput}
                    onChange={(e) => handleNameChange(e.target.value)}
                    className="bg-card h-10"
                    placeholder="Your display name"
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <Label className="text-xs font-medium text-muted-foreground">Email Address</Label>
                    {pendingChanges.email !== undefined && pendingChanges.email !== user?.email && (
                      <Badge variant="outline" className="text-[10px] bg-amber-500/10 text-amber-500 border-amber-500/20">Modified</Badge>
                    )}
                  </div>
                  <Input
                    type="email"
                    value={emailInput}
                    onChange={(e) => handleEmailChange(e.target.value)}
                    className="bg-card h-10"
                    placeholder="Your email address"
                  />
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Quick Links to Other Settings */}
      <section>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-primary/10">
            <Zap className="h-4 w-4 text-primary" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-foreground">Quick Settings</h2>
            <p className="text-sm text-muted-foreground">Shortcuts to other account settings</p>
          </div>
        </div>
        <Card className="border-border/50 bg-card/50">
          <CardContent className="pt-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                onClick={() => onTabChange("security")}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/80 hover:border-primary/30 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-primary/10">
                  <Lock className="h-4 w-4 text-primary" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Security</p>
                  <p className="text-xs text-muted-foreground">Password, 2FA, sessions</p>
                </div>
              </button>
              <button
                onClick={() => onTabChange("social")}
                className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-card/30 hover:bg-card/80 hover:border-primary/30 transition-colors text-left"
              >
                <div className="p-2 rounded-lg bg-[#5865F2]/10">
                  <Share2 className="h-4 w-4 text-[#5865F2]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">Connected Accounts</p>
                  <p className="text-xs text-muted-foreground">Discord integration</p>
                </div>
              </button>
            </div>
          </CardContent>
        </Card>
      </section>
    </div>
  )
}
