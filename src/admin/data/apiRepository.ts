/**
 * Phase 2 repository — the REST-backed implementation of `AdminRepository`.
 *
 * Not wired up yet (see `ADMIN_CONFIG.api.enabled`). It is written against the
 * same interface the local repository implements, which is the proof that the
 * UI is backend-agnostic: switching to PHP + MySQL is a one-line change in
 * `repository.ts`.
 *
 *   export const repository = ADMIN_CONFIG.api.enabled
 *     ? createApiRepository()
 *     : localRepository
 */
import { ADMIN_CONFIG } from '@/admin/config/adminConfig'
import type {
  ActivityEntry,
  AdminWorkspace,
  BlogPost,
  HomepageSection,
  LeadRecord,
  NicheRecord,
  PageRecord,
  ServiceRecord,
  SeoSettings,
  SiteSettings,
  TrackingNumber,
} from '@/admin/types/admin'
import { apiClient } from './apiClient'
import type { AdminRepository, NewNiche, NewNumber, NewPage, NewPost, NewService } from './repository'

const { endpoints } = ADMIN_CONFIG.api

export const createApiRepository = (): AdminRepository => ({
  mode: 'api',

  getWorkspace: () => apiClient.request<AdminWorkspace>('/workspace'),
  resetDemoData: () => apiClient.request<AdminWorkspace>('/demo/reset', { method: 'POST' }),

  listServices: () => apiClient.request<ServiceRecord[]>(endpoints.services),
  createService: (input: NewService) =>
    apiClient.request<ServiceRecord>(endpoints.services, { method: 'POST', body: input }),
  updateService: (id, patch) =>
    apiClient.request<ServiceRecord>(`${endpoints.services}/${id}`, { method: 'PATCH', body: patch }),
  deleteService: (id) => apiClient.request<void>(`${endpoints.services}/${id}`, { method: 'DELETE' }),

  listNumbers: () => apiClient.request<TrackingNumber[]>(endpoints.numbers),
  createNumber: (input: NewNumber) =>
    apiClient.request<TrackingNumber>(endpoints.numbers, { method: 'POST', body: input }),
  updateNumber: (id, patch) =>
    apiClient.request<TrackingNumber>(`${endpoints.numbers}/${id}`, { method: 'PATCH', body: patch }),
  deleteNumber: (id) => apiClient.request<void>(`${endpoints.numbers}/${id}`, { method: 'DELETE' }),

  listNiches: () => apiClient.request<NicheRecord[]>(endpoints.niches),
  createNiche: (input: NewNiche) =>
    apiClient.request<NicheRecord>(endpoints.niches, { method: 'POST', body: input }),
  updateNiche: (id, patch) =>
    apiClient.request<NicheRecord>(`${endpoints.niches}/${id}`, { method: 'PATCH', body: patch }),
  deleteNiche: (id) => apiClient.request<void>(`${endpoints.niches}/${id}`, { method: 'DELETE' }),

  listPages: () => apiClient.request<PageRecord[]>(endpoints.pages),
  createPage: (input: NewPage) => apiClient.request<PageRecord>(endpoints.pages, { method: 'POST', body: input }),
  updatePage: (id, patch) =>
    apiClient.request<PageRecord>(`${endpoints.pages}/${id}`, { method: 'PATCH', body: patch }),
  deletePage: (id) => apiClient.request<void>(`${endpoints.pages}/${id}`, { method: 'DELETE' }),

  listPosts: () => apiClient.request<BlogPost[]>(endpoints.posts),
  createPost: (input: NewPost) => apiClient.request<BlogPost>(endpoints.posts, { method: 'POST', body: input }),
  updatePost: (id, patch) =>
    apiClient.request<BlogPost>(`${endpoints.posts}/${id}`, { method: 'PATCH', body: patch }),
  deletePost: (id) => apiClient.request<void>(`${endpoints.posts}/${id}`, { method: 'DELETE' }),

  listSections: () => apiClient.request<HomepageSection[]>(endpoints.sections),
  updateSection: (id, patch) =>
    apiClient.request<HomepageSection>(`${endpoints.sections}/${id}`, { method: 'PATCH', body: patch }),
  moveSection: (id, direction) =>
    apiClient.request<HomepageSection[]>(`${endpoints.sections}/${id}/move`, { method: 'POST', body: { direction } }),
  createSection: (input) => apiClient.request<HomepageSection>(endpoints.sections, { method: 'POST', body: input }),
  deleteSection: (id) => apiClient.request<void>(`${endpoints.sections}/${id}`, { method: 'DELETE' }),

  listLeads: () => apiClient.request<LeadRecord[]>(endpoints.leads),
  updateLead: (id, patch) =>
    apiClient.request<LeadRecord>(`${endpoints.leads}/${id}`, { method: 'PATCH', body: patch }),
  deleteLead: (id) => apiClient.request<void>(`${endpoints.leads}/${id}`, { method: 'DELETE' }),

  getSettings: () => apiClient.request<SiteSettings>(endpoints.settings),
  updateSettings: (patch) => apiClient.request<SiteSettings>(endpoints.settings, { method: 'PATCH', body: patch }),

  getSeo: () => apiClient.request<SeoSettings>(endpoints.seo),
  updateSeo: (patch) => apiClient.request<SeoSettings>(endpoints.seo, { method: 'PATCH', body: patch }),

  listActivity: () => apiClient.request<ActivityEntry[]>('/activity'),
  logActivity: (action, target, actor) =>
    apiClient.request<void>('/activity', { method: 'POST', body: { action, target, actor } }).then(() => undefined),
})
