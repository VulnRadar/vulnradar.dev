"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { Loader2 } from "lucide-react"
import { Header } from "@/components/scanner/header"
import { Footer } from "@/components/scanner/footer"
import { API } from "@/lib/config/constants"
import {
  ProfileProvider,
  useProfile,
  ProfileSidebar,
  ProfileGeneralTab,
  ProfileSecurityTab,
  ProfileSocialTab,
  ProfileBillingTab,
  ProfileDeveloperTab,
  ProfileNotificationsTab,
  ProfilePrivacyTab,
} from "@/components/profile"

function ProfileContent() {
  const { activeTab, profile, setProfile, isLoading, setIsLoading } = useProfile()
  const router = useRouter()

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        setIsLoading(true)
        const res = await fetch(API.ME, { credentials: "include" })
        if (res.ok) {
          const data = await res.json()
          setProfile(data)
        } else if (res.status === 401) {
          router.push("/login?redirect=/profile")
        }
      } catch (error) {
        console.error("Failed to fetch profile:", error)
      } finally {
        setIsLoading(false)
      }
    }

    fetchProfile()
  }, [setProfile, setIsLoading, router])

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!profile) {
    return (
      <div className="flex-1 flex items-center justify-center py-16">
        <p className="text-muted-foreground">Failed to load profile</p>
      </div>
    )
  }

  return (
    <div className="flex-1 container max-w-5xl py-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-semibold text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account settings and preferences</p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6 lg:gap-8">
        <ProfileSidebar />
        
        <main className="flex-1 min-w-0">
          {activeTab === "general" && <ProfileGeneralTab />}
          {activeTab === "security" && <ProfileSecurityTab />}
          {activeTab === "social" && <ProfileSocialTab />}
          {activeTab === "billing" && <ProfileBillingTab />}
          {activeTab === "developer" && <ProfileDeveloperTab />}
          {activeTab === "notifications" && <ProfileNotificationsTab />}
          {activeTab === "privacy" && <ProfilePrivacyTab />}
        </main>
      </div>
    </div>
  )
}

export default function ProfilePage() {
  return (
    <ProfileProvider>
      <div className="min-h-screen flex flex-col bg-background">
        <Header />
        <ProfileContent />
        <Footer />
      </div>
    </ProfileProvider>
  )
}
