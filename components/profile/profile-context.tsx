"use client"

import { createContext, useContext, useState, useCallback, type ReactNode } from "react"
import { toast } from "sonner"
import { API } from "@/lib/config/constants"
import type {
  ProfileTab,
  UserProfile,
  ApiKey,
  Webhook,
  Session,
  NotificationSettings,
  PrivacySettings,
  BillingInfo,
} from "./profile-types"

interface ProfileContextValue {
  // Current tab
  activeTab: ProfileTab
  setActiveTab: (tab: ProfileTab) => void

  // User profile
  profile: UserProfile | null
  setProfile: (profile: UserProfile | null) => void
  isLoading: boolean
  setIsLoading: (loading: boolean) => void

  // API Keys
  apiKeys: ApiKey[]
  setApiKeys: (keys: ApiKey[]) => void
  
  // Webhooks
  webhooks: Webhook[]
  setWebhooks: (webhooks: Webhook[]) => void

  // Sessions
  sessions: Session[]
  setSessions: (sessions: Session[]) => void

  // Notification settings
  notificationSettings: NotificationSettings
  setNotificationSettings: (settings: NotificationSettings) => void

  // Privacy settings
  privacySettings: PrivacySettings
  setPrivacySettings: (settings: PrivacySettings) => void

  // Billing
  billingInfo: BillingInfo | null
  setBillingInfo: (info: BillingInfo | null) => void

  // Actions
  refreshProfile: () => Promise<void>
  updateProfile: (updates: Partial<UserProfile>) => Promise<boolean>
  uploadAvatar: (file: File) => Promise<string | null>
  deleteAvatar: () => Promise<boolean>
}

const ProfileContext = createContext<ProfileContextValue | null>(null)

const defaultNotificationSettings: NotificationSettings = {
  emailScanComplete: true,
  emailSecurityAlerts: true,
  emailWeeklyDigest: false,
  emailProductUpdates: false,
  pushEnabled: false,
  slackEnabled: false,
  slackWebhook: "",
}

const defaultPrivacySettings: PrivacySettings = {
  profilePublic: false,
  showEmail: false,
  showSocialLinks: true,
  allowDataCollection: true,
  shareAnonymousData: true,
}

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [activeTab, setActiveTab] = useState<ProfileTab>("general")
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [webhooks, setWebhooks] = useState<Webhook[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [notificationSettings, setNotificationSettings] = useState<NotificationSettings>(defaultNotificationSettings)
  const [privacySettings, setPrivacySettings] = useState<PrivacySettings>(defaultPrivacySettings)
  const [billingInfo, setBillingInfo] = useState<BillingInfo | null>(null)

  const refreshProfile = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch(API.ME, { credentials: "include" })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
      }
    } catch (error) {
      console.error("Failed to refresh profile:", error)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const updateProfile = useCallback(async (updates: Partial<UserProfile>): Promise<boolean> => {
    try {
      const res = await fetch(API.ME, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(updates),
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(data)
        toast.success("Profile updated")
        return true
      } else {
        const error = await res.json()
        toast.error(error.message || "Failed to update profile")
        return false
      }
    } catch (error) {
      toast.error("Failed to update profile")
      return false
    }
  }, [])

  const uploadAvatar = useCallback(async (file: File): Promise<string | null> => {
    try {
      const formData = new FormData()
      formData.append("avatar", file)
      const res = await fetch(`${API.ME}/avatar`, {
        method: "POST",
        credentials: "include",
        body: formData,
      })
      if (res.ok) {
        const data = await res.json()
        setProfile((prev) => prev ? { ...prev, avatar: data.avatar } : null)
        toast.success("Avatar uploaded")
        return data.avatar
      } else {
        toast.error("Failed to upload avatar")
        return null
      }
    } catch (error) {
      toast.error("Failed to upload avatar")
      return null
    }
  }, [])

  const deleteAvatar = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch(`${API.ME}/avatar`, {
        method: "DELETE",
        credentials: "include",
      })
      if (res.ok) {
        setProfile((prev) => prev ? { ...prev, avatar: null } : null)
        toast.success("Avatar removed")
        return true
      } else {
        toast.error("Failed to remove avatar")
        return false
      }
    } catch (error) {
      toast.error("Failed to remove avatar")
      return false
    }
  }, [])

  return (
    <ProfileContext.Provider
      value={{
        activeTab,
        setActiveTab,
        profile,
        setProfile,
        isLoading,
        setIsLoading,
        apiKeys,
        setApiKeys,
        webhooks,
        setWebhooks,
        sessions,
        setSessions,
        notificationSettings,
        setNotificationSettings,
        privacySettings,
        setPrivacySettings,
        billingInfo,
        setBillingInfo,
        refreshProfile,
        updateProfile,
        uploadAvatar,
        deleteAvatar,
      }}
    >
      {children}
    </ProfileContext.Provider>
  )
}

export function useProfile() {
  const context = useContext(ProfileContext)
  if (!context) {
    throw new Error("useProfile must be used within a ProfileProvider")
  }
  return context
}
