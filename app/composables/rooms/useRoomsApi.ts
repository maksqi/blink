/**
 * Typed wrappers for the rooms API (docs/API.md §5) over `useApi()`. Errors are `ApiError`s with stable codes.
 * Room keys never pass through here: only join proofs do.
 */
import type { Paginated } from '#shared/schemas/common'
import type { MeetingSummary, RoomDetails, RoomInvite, RoomSummary } from '#shared/schemas/rooms'
import type { CreateRoomBody } from '~/lib/join/create-room'

export type InviteExpiry = '1h' | '24h' | '7d' | 'never'

export interface RoomUpdate {
  name?: string
  waitingRoom?: boolean
  allowGuests?: boolean
  muteOnJoin?: boolean
  allowSelfUnmute?: boolean
  screenSharePolicy?: 'everyone' | 'hosts'
  chatEnabled?: boolean
  maxParticipants?: number
  /** null removes the password. */
  password?: string | null
}

const room = (id: string) => `/api/rooms/${encodeURIComponent(id)}`

export function useRoomsApi() {
  const api = useApi()
  return {
    list: (query: { page: number; pageSize: number }) => api<Paginated<RoomSummary>>('/api/rooms', { query }),
    get: async (id: string) => (await api<{ room: RoomDetails }>(room(id))).room,
    create: (body: CreateRoomBody) => api<{ room: RoomDetails }>('/api/rooms', { method: 'POST', body }),
    update: async (id: string, body: RoomUpdate) =>
      (await api<{ room: RoomDetails }>(room(id), { method: 'PATCH', body })).room,
    remove: (id: string) => api<unknown>(room(id), { method: 'DELETE' }),
    rotateKey: async (id: string, proof: string) =>
      (await api<{ room: RoomDetails }>(`${room(id)}/key`, { method: 'PUT', body: { proof } })).room,
    removeCohost: (id: string, userId: string) =>
      api<unknown>(`${room(id)}/cohosts/${encodeURIComponent(userId)}`, { method: 'DELETE' }),
    invites: async (id: string) => (await api<{ items: RoomInvite[] }>(`${room(id)}/invites`)).items,
    createInvite: async (id: string, body: { label?: string; expiresIn: InviteExpiry; maxUses: number | null }) =>
      (await api<{ invite: RoomInvite }>(`${room(id)}/invites`, { method: 'POST', body })).invite,
    revokeInvite: (id: string, inviteId: string) =>
      api<unknown>(`${room(id)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' }),
    meetings: (id: string, query: { page: number; pageSize: number }) =>
      api<Paginated<MeetingSummary>>(`${room(id)}/meetings`, { query }),
  }
}
