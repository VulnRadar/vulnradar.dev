"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail, Copy, Send } from "lucide-react"

interface Broadcast {
  id: string
  title: string
  status: string
  created_at: string
  sent_at?: string
  created_by_name?: string
  sent_by_name?: string
}

export function MassEmailManager() {
  const [messages, setMessages] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [segment, setSegment] = useState("all")
  const [messageType, setMessageType] = useState("info")

  useEffect(() => {
    fetchMessages()
  }, [])

  async function fetchMessages() {
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list", section: "broadcast" })
      })
      const data = await res.json()
      setMessages(data.messages || [])
    } catch (err) {
      console.error("Error fetching messages:", err)
    }
  }

  async function handleCreate() {
    if (!title || !content) return
    setLoading(true)
    try {
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "broadcast",
          title,
          content,
          message_type: messageType,
          segment_filter: segment
        })
      })
      if (res.ok) {
        setTitle("")
        setContent("")
        setSegment("all")
        fetchMessages()
      }
    } catch (err) {
      console.error("Error creating message:", err)
    } finally {
      setLoading(false)
    }
  }

  async function handleSend(id: string) {
    setLoading(true)
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", section: "broadcast", id })
      })
      fetchMessages()
    } catch (err) {
      console.error("Error sending:", err)
    } finally {
      setLoading(false)
    }
  }

  async function handleResend(id: string) {
    setLoading(true)
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resend", section: "broadcast", id })
      })
      fetchMessages()
    } catch (err) {
      console.error("Error resending:", err)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            Create Broadcast
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder="Subject"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          
          <Textarea
            placeholder="Email content (HTML supported)"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="min-h-32"
          />

          <div className="grid grid-cols-2 gap-4">
            <Select value={messageType} onValueChange={setMessageType}>
              <SelectTrigger>
                <SelectValue placeholder="Message type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="info">Info</SelectItem>
                <SelectItem value="alert">Alert</SelectItem>
                <SelectItem value="announcement">Announcement</SelectItem>
              </SelectContent>
            </Select>

            <Select value={segment} onValueChange={setSegment}>
              <SelectTrigger>
                <SelectValue placeholder="Segment" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Users</SelectItem>
                <SelectItem value="premium">Premium Only</SelectItem>
                <SelectItem value="free">Free Tier</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={handleCreate} disabled={loading || !title || !content} className="w-full">
            Save as Draft
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcasts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {messages.map((msg) => (
              <div key={msg.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{msg.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Created by {msg.created_by_name || "Unknown"} • {new Date(msg.created_at).toLocaleDateString()}
                  </p>
                  {msg.status === "sent" && msg.sent_by_name && (
                    <p className="text-sm text-muted-foreground">
                      Sent by {msg.sent_by_name}
                    </p>
                  )}
                  <span className="text-xs bg-secondary px-2 py-1 rounded mt-1 inline-block">
                    {msg.status}
                  </span>
                </div>

                <div className="flex gap-2">
                  {msg.status === "draft" && (
                    <>
                      <Button
                        size="sm"
                        onClick={() => handleSend(msg.id)}
                        disabled={loading}
                      >
                        <Send className="w-4 h-4 mr-1" />
                        Send
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleResend(msg.id)}
                        disabled={loading}
                      >
                        <Copy className="w-4 h-4 mr-1" />
                        Duplicate
                      </Button>
                    </>
                  )}
                  {msg.status === "sent" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleResend(msg.id)}
                      disabled={loading}
                    >
                      <Copy className="w-4 h-4 mr-1" />
                      Resend
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
