import type { SessionMeta } from '@/types/session'

export interface SessionGroup<T extends SessionMeta = SessionMeta> {
  label: string
  sessions: T[]
}

/**
 * Classify a date string into a relative group label.
 * Matches n8n's grouping: Today, Yesterday, This week, Older.
 */
function getRelativeGroup(now: Date, dateString: string): string {
  const date = new Date(dateString)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const lastWeek = new Date(today)
  lastWeek.setDate(lastWeek.getDate() - 7)

  const conversationDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (conversationDate.getTime() === today.getTime()) {
    return 'Today'
  } else if (conversationDate.getTime() === yesterday.getTime()) {
    return 'Yesterday'
  } else if (conversationDate >= lastWeek) {
    return 'This week'
  } else {
    return 'Older'
  }
}

/**
 * Group sessions by date (Today, Yesterday, This week, Older).
 * Sessions within each group are sorted newest first.
 */
export function groupSessionsByDate<T extends SessionMeta>(sessions: T[]): SessionGroup<T>[] {
  const now = new Date()
  const groupOrder = ['Today', 'Yesterday', 'This week', 'Older']
  const groups = new Map<string, T[]>()

  for (const session of sessions) {
    const group = getRelativeGroup(now, session.updatedAt)
    if (!groups.has(group)) {
      groups.set(group, [])
    }
    groups.get(group)!.push(session)
  }

  return groupOrder.flatMap((label) => {
    const items = groups.get(label)
    if (!items || items.length === 0) return []
    // Sort newest first within group
    items.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))
    return [{ label, sessions: items }]
  })
}
