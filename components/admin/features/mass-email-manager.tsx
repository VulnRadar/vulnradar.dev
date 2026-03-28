"use client"

import React, { useState, useEffect } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail, Send, BarChart3, RefreshCw, Users } from "lucide-react"
import { cn } from "@/lib/utils"

interface BroadcastMessage {
  id: number
  title: string
  content: string
  message_type: string
  status: "draft" | "scheduled" | "sent" | "cancelled"
  recipient_count?: number
  opened_count?: number
  created_at: string
  sent_at?: string
  segment_filter?: { segment: string }
}

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  scheduled: "bg-blue-500/10 text-blue-700 border-blue-500/20",
  sent: "bg-green-500/10 text-green-700 border-green-500/20",
  cancelled: "bg-red-500/10 text-red-700 border-red-500/20",
}

const segmentLabels: Record<string, string> = {
  all: "All Users",
  free: "Free Plan",
  core_supporter: "Core Supporters",
  pro_supporter: "Pro Supporters",
  elite_supporter: "Elite Supporters",
  paid: "All Paid Users",
}

export function MassEmailManager() {
  const [messages, setMessages] = useState<BroadcastMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)

  // Form state
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [targetSegment, setTargetSegment] = useState("all")

  const fetchMessages = async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "broadcast" }),
      })
      const data = await res.json()
      setMessages(data.messages || [])
    } catch (error) {
      console.error("Error fetching messages:", error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchMessages()
  }, [])

  const handleCreateMessage = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title || !content) return

    setCreating(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "broadcast",
          title,
          content,
          message_type: "email",
          segment_filter: { segment: targetSegment },
        }),
      })

      if (res.ok) {
        setTitle("")
        setContent("")
        setTargetSegment("all")
        await fetchMessages()
      }
    } catch (error) {
      console.error("Error creating message:", error)
    } finally {
      setCreating(false)
    }
  }

  const handleSendMessage = async (id: number) => {
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          section: "broadcast",
          id,
        }),
      })
      await fetchMessages()
    } catch (error) {
      console.error("Error sending message:", error)
    }
  }

  const draftMessages = messages.filter((m) => m.status === "draft")
  const sentMessages = messages.filter((m) => m.status === "sent")

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <Mail className="h-8 w-8 text-blue-500 mb-2" />
            <div className="text-3xl font-bold">{draftMessages.length}</div>
            <p className="text-sm text-muted-foreground mt-1">Draft Messages</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <Send className="h-8 w-8 text-green-500 mb-2" />
            <div className="text-3xl font-bold">{sentMessages.length}</div>
            <p className="text-sm text-muted-foreground mt-1">Sent Messages</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <BarChart3 className="h-8 w-8 text-purple-500 mb-2" />
            <div className="text-3xl font-bold">
              {sentMessages.reduce((acc, m) => acc + (m.opened_count || 0), 0)}
            </div>
            <p className="text-sm text-muted-foreground mt-1">Total Opens</p>
          </CardContent>
        </Card>
      </div>

      {/* Create Message */}
      <Card>
        <CardHeader>
          <CardTitle>Compose Email</CardTitle>
          <CardDescription>Create and send email broadcasts to users</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleCreateMessage} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium mb-2 block">Subject Line</label>
                <Input
                  placeholder="Email subject"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-2 block">Target Audience</label>
                <Select value={targetSegment} onValueChange={setTargetSegment}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Users</SelectItem>
                    <SelectItem value="free">Free Plan Only</SelectItem>
                    <SelectItem value="paid">All Paid Users</SelectItem>
                    <SelectItem value="core_supporter">Core Supporters</SelectItem>
                    <SelectItem value="pro_supporter">Pro Supporters</SelectItem>
                    <SelectItem value="elite_supporter">Elite Supporters</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <label className="text-sm font-medium mb-2 block">Email Body</label>
              <Textarea
                placeholder="Write your email content here... You can use basic HTML for formatting."
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={8}
                required
                className="font-mono text-sm"
              />
              <p className="text-xs text-muted-foreground mt-2">
                Tip: Use HTML tags like {"<b>"}, {"<i>"}, {"<a href='...'>"} for formatting
              </p>
            </div>

            <Button type="submit" disabled={creating} className="w-full">
              <Mail className="h-4 w-4 mr-2" />
              {creating ? "Creating..." : "Create Email Draft"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Messages List */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Email History</CardTitle>
              <CardDescription>All broadcast emails</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={fetchMessages} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {messages.length === 0 ? (
              <p className="text-sm text-muted-foreground py-8 text-center">No emails sent yet</p>
            ) : (
              messages.map((message) => (
                <div
                  key={message.id}
                  className="p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold truncate">{message.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        {message.content.replace(/<[^>]*>/g, "").substring(0, 150)}...
                      </p>
                    </div>
                    <Badge className={statusColors[message.status]}>
                      {message.status}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between pt-3 border-t border-border">
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {segmentLabels[message.segment_filter?.segment || "all"]}
                      </span>
                      {message.recipient_count !== undefined && (
                        <span>{message.recipient_count} recipients</span>
                      )}
                      <span>{new Date(message.created_at).toLocaleDateString()}</span>
                    </div>
                    {message.status === "draft" && (
                      <Button
                        size="sm"
                        onClick={() => handleSendMessage(message.id)}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Send Now
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
