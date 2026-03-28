"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Mail, Send, Eye, Trash2, RefreshCw } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

interface Broadcast {
  id: string
  title: string
  status: string
  created_at: string
  sent_at?: string
  created_by_name?: string
  sent_by_name?: string
}

const EMAIL_COLORS = {
  BG_DARK: "#0a0e13",
  BG_CARD: "#0f172a",
  BORDER: "#1e293b",
  TEXT_PRIMARY: "#f8fafc",
  TEXT_SECONDARY: "#94a3b8",
  TEXT_MUTED: "#64748b",
  TEXT_DARK: "#475569",
  ACCENT_BLUE: "#2563eb",
  ACCENT_BLUE_LIGHT: "#3b82f6",
}

function generatePreviewHtml(title: string, content: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <style>body { margin: 0; }</style>
</head>
<body style="margin: 0; padding: 0; background-color: ${EMAIL_COLORS.BG_DARK}; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #e5e7eb;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color: ${EMAIL_COLORS.BG_DARK}; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width: 600px; width: 100%;">
          <tr>
            <td style="padding: 0 0 20px 0; text-align: center;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="padding-bottom: 12px;">
                    <img src="https://vulnradar.dev/favicon-dark.svg" alt="VulnRadar" width="48" height="48" style="display: block; margin: 0 auto;" />
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <h1 style="margin: 0; font-size: 24px; font-weight: 700; color: ${EMAIL_COLORS.TEXT_PRIMARY}; letter-spacing: -0.3px;">VulnRadar</h1>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding: 0 0 24px 0;">
              <div style="height: 2px; background: linear-gradient(90deg, ${EMAIL_COLORS.ACCENT_BLUE}, ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}); border-radius: 999px;"></div>
            </td>
          </tr>
          <tr>
            <td style="background-color: ${EMAIL_COLORS.BG_CARD}; border: 1px solid ${EMAIL_COLORS.BORDER}; border-radius: 12px; padding: 32px 28px;">
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: ${EMAIL_COLORS.TEXT_PRIMARY};">${title || "Subject"}</h2>
              <div style="font-size: 14px; color: ${EMAIL_COLORS.TEXT_SECONDARY}; line-height: 1.6;">${content || "<p>Email content will appear here...</p>"}</div>
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 20px 0 20px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td style="text-align: center;">
                    <p style="margin: 0 0 8px 0; font-size: 12px; color: ${EMAIL_COLORS.TEXT_MUTED}; line-height: 1.6;">
                      <a href="https://vulnradar.dev" style="color: ${EMAIL_COLORS.ACCENT_BLUE_LIGHT}; text-decoration: none;">vulnradar.dev</a>
                    </p>
                    <p style="margin: 0; font-size: 11px; color: ${EMAIL_COLORS.TEXT_DARK}; line-height: 1.5;">
                      VulnRadar - Web Vulnerability Scanner<br />
                      This is an automated message. Please do not reply directly.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

export function MassEmailManager() {
  const [messages, setMessages] = useState<Broadcast[]>([])
  const [loading, setLoading] = useState(false)
  const [title, setTitle] = useState("")
  const [content, setContent] = useState("")
  const [segment, setSegment] = useState("all")
  const [specificEmail, setSpecificEmail] = useState("")
  const [previewOpen, setPreviewOpen] = useState(false)

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
    if (segment === "specific" && !specificEmail) return
    setLoading(true)
    try {
      const segmentFilter = segment === "specific" 
        ? { segment: `email:${specificEmail}` }
        : { segment }
      
      const res = await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create",
          section: "broadcast",
          title,
          content,
          message_type: "email",
          segment_filter: segmentFilter
        })
      })
      if (res.ok) {
        setTitle("")
        setContent("")
        setSegment("all")
        setSpecificEmail("")
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

  async function handleDelete(id: string) {
    if (!confirm("Delete this draft?")) return
    setLoading(true)
    try {
      await fetch("/api/v2/admin/features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", section: "broadcast", id })
      })
      fetchMessages()
    } catch (err) {
      console.error("Error deleting:", err)
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

          <Select value={segment} onValueChange={setSegment}>
            <SelectTrigger>
              <SelectValue placeholder="Recipients" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Users</SelectItem>
              <SelectItem value="premium">All Premium Users</SelectItem>
              <SelectItem value="free">Free Users</SelectItem>
              <SelectItem value="core_supporter">Core Supporter</SelectItem>
              <SelectItem value="pro_supporter">Pro Supporter</SelectItem>
              <SelectItem value="elite_supporter">Elite Supporter</SelectItem>
              <SelectItem value="specific">Specific Email</SelectItem>
            </SelectContent>
          </Select>

          {segment === "specific" && (
            <Input
              type="email"
              placeholder="Enter email address"
              value={specificEmail}
              onChange={(e) => setSpecificEmail(e.target.value)}
            />
          )}

          <div className="flex gap-2">
            <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" className="flex-1">
                  <Eye className="w-4 h-4 mr-2" />
                  Preview
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-3xl max-h-[80vh] overflow-auto">
                <DialogHeader>
                  <DialogTitle>Email Preview</DialogTitle>
                </DialogHeader>
                <iframe
                  srcDoc={generatePreviewHtml(title, content)}
                  className="w-full h-[600px] border rounded-lg"
                  title="Email Preview"
                />
              </DialogContent>
            </Dialog>

            <Button 
              onClick={handleCreate} 
              disabled={loading || !title || !content || (segment === "specific" && !specificEmail)} 
              className="flex-1"
            >
              Save as Draft
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Broadcasts</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No broadcasts yet</p>
            )}
            {messages.map((msg) => (
              <div key={msg.id} className="flex items-center justify-between p-3 border rounded-lg">
                <div className="flex-1">
                  <p className="font-medium">{msg.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Created by {msg.created_by_name || "Unknown"} - {new Date(msg.created_at).toLocaleDateString()}
                  </p>
                  {msg.status === "sent" && (
                    <p className="text-sm text-muted-foreground">
                      {msg.sent_by_name ? `Last sent by ${msg.sent_by_name}` : "Sent"} - {msg.sent_at ? new Date(msg.sent_at).toLocaleString() : ""}
                    </p>
                  )}
                  <span className={`text-xs px-2 py-1 rounded mt-1 inline-block ${msg.status === "sent" ? "bg-green-500/20 text-green-400" : "bg-secondary"}`}>
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
                        onClick={() => handleDelete(msg.id)}
                        disabled={loading}
                      >
                        <Trash2 className="w-4 h-4" />
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
                      <RefreshCw className="w-4 h-4 mr-1" />
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
