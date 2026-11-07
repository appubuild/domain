/**
 * ============================================================================
 *  DATA ACCESS LAYER — REPOSITORY PATTERN
 * ============================================================================
 *  UI components never touch storage directly. They call this repository,
 *  which is async on purpose: Phase 2 swaps `localRepository` for
 *  `createApiRepository()` (see ./apiRepository.ts) and the pages keep working
 *  unchanged.
 *
 *      UI  →  AdminRepository  →  LocalStorageRepository   (Phase 1)
 *                              →  ApiRepository            (Phase 2, PHP + MySQL)
 *
 *  Every mutation is validated here (unique slugs, unique numbers, required
 *  fields) so the same rules apply when the PHP API takes over.
 * ============================================================================
 */
import { storageKey } from '@/admin/config/adminConfig'
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
import { delay, makeId, readJSON, writeJSON } from './storage'
import { DEMO_WORKSPACE_VERSION, buildSeedWorkspace } from './seed'

export type NewService = Omit<ServiceRecord, 'id' | 'updatedAt'>
export type NewNumber = Omit<TrackingNumber, 'id' | 'createdAt' | 'updatedAt'>
export type NewNiche = Omit<NicheRecord, 'id' | 'createdAt'>
export type NewPage = Omit<PageRecord, 'id' | 'updatedAt' | 'updatedBy'>
export type NewPost = Omit<BlogPost, 'id' | 'updatedAt'>

export interface AdminRepository {
  readonly mode: 'local' | 'api'

  getWorkspace(): Promise<AdminWorkspace>
  resetDemoData(): Promise<AdminWorkspace>

  listServices(): Promise<ServiceRecord[]>
  createService(input: NewService): Promise<ServiceRecord>
  updateService(id: string, patch: Partial<ServiceRecord>): Promise<ServiceRecord>
  deleteService(id: string): Promise<void>

  listNumbers(): Promise<TrackingNumber[]>
  createNumber(input: NewNumber): Promise<TrackingNumber>
  updateNumber(id: string, patch: Partial<TrackingNumber>): Promise<TrackingNumber>
  deleteNumber(id: string): Promise<void>

  listNiches(): Promise<NicheRecord[]>
  createNiche(input: NewNiche): Promise<NicheRecord>
  updateNiche(id: string, patch: Partial<NicheRecord>): Promise<NicheRecord>
  deleteNiche(id: string): Promise<void>

  listPages(): Promise<PageRecord[]>
  createPage(input: NewPage): Promise<PageRecord>
  updatePage(id: string, patch: Partial<PageRecord>): Promise<PageRecord>
  deletePage(id: string): Promise<void>

  listPosts(): Promise<BlogPost[]>
  createPost(input: NewPost): Promise<BlogPost>
  updatePost(id: string, patch: Partial<BlogPost>): Promise<BlogPost>
  deletePost(id: string): Promise<void>

  listSections(): Promise<HomepageSection[]>
  updateSection(id: string, patch: Partial<HomepageSection>): Promise<HomepageSection>
  moveSection(id: string, direction: 'up' | 'down'): Promise<HomepageSection[]>
  createSection(input: Omit<HomepageSection, 'id'>): Promise<HomepageSection>
  deleteSection(id: string): Promise<void>

  listLeads(): Promise<LeadRecord[]>
  updateLead(id: string, patch: Partial<LeadRecord>): Promise<LeadRecord>
  deleteLead(id: string): Promise<void>

  getSettings(): Promise<SiteSettings>
  updateSettings(patch: Partial<SiteSettings>): Promise<SiteSettings>

  getSeo(): Promise<SeoSettings>
  updateSeo(patch: Partial<SeoSettings>): Promise<SeoSettings>

  listActivity(): Promise<ActivityEntry[]>
  logActivity(action: string, target: string, actor?: string): Promise<void>
}

const WORKSPACE_KEY = storageKey('workspace.v1')

const normaliseSlug = (value: string): string =>
  value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

const now = (): string => new Date().toISOString()

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

/**
 * Local demo repository. Small artificial latency keeps loading states honest
 * and makes the Phase 2 swap (real network latency) invisible to the UI.
 */
class LocalStorageRepository implements AdminRepository {
  readonly mode = 'local' as const

  private load(): AdminWorkspace {
    const stored = readJSON<AdminWorkspace | null>(WORKSPACE_KEY, null)
    if (stored && stored.version === DEMO_WORKSPACE_VERSION) return stored
    const seeded = buildSeedWorkspace()
    writeJSON(WORKSPACE_KEY, seeded)
    return seeded
  }

  private save(workspace: AdminWorkspace): void {
    writeJSON(WORKSPACE_KEY, workspace)
  }

  private async mutate<T>(mutator: (workspace: AdminWorkspace) => T): Promise<T> {
    const workspace = this.load()
    const result = mutator(workspace)
    this.save(workspace)
    await delay()
    return clone(result)
  }

  private async read<T>(selector: (workspace: AdminWorkspace) => T): Promise<T> {
    await delay(80)
    return clone(selector(this.load()))
  }

  async getWorkspace(): Promise<AdminWorkspace> {
    return this.read((workspace) => workspace)
  }

  async resetDemoData(): Promise<AdminWorkspace> {
    const seeded = buildSeedWorkspace()
    this.save(seeded)
    await delay()
    return clone(seeded)
  }

  /* ----------------------------- services ------------------------------- */

  listServices(): Promise<ServiceRecord[]> {
    return this.read((workspace) => workspace.services)
  }

  async createService(input: NewService): Promise<ServiceRecord> {
    return this.mutate((workspace) => {
      const slug = normaliseSlug(input.slug || input.name)
      if (!slug) throw new Error('A service slug is required.')
      if (workspace.services.some((service) => service.slug === slug)) {
        throw new Error(`A service with the slug “${slug}” already exists.`)
      }
      const record: ServiceRecord = {
        ...input,
        slug,
        id: makeId('svc'),
        sortOrder: input.sortOrder || workspace.services.length + 1,
        updatedAt: now(),
      }
      workspace.services.push(record)
      this.pushActivity(workspace, 'Created service', record.name)
      return record
    })
  }

  async updateService(id: string, patch: Partial<ServiceRecord>): Promise<ServiceRecord> {
    return this.mutate((workspace) => {
      const record = workspace.services.find((service) => service.id === id)
      if (!record) throw new Error('Service not found.')
      if (patch.slug) {
        const slug = normaliseSlug(patch.slug)
        const clash = workspace.services.some((service) => service.slug === slug && service.id !== id)
        if (clash) throw new Error(`A service with the slug “${slug}” already exists.`)
        patch = { ...patch, slug }
      }
      Object.assign(record, patch, { updatedAt: now() })
      this.pushActivity(workspace, 'Updated service', record.name)
      return record
    })
  }

  async deleteService(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.services.findIndex((service) => service.id === id)
      if (index === -1) throw new Error('Service not found.')
      const [removed] = workspace.services.splice(index, 1)
      this.pushActivity(workspace, 'Deleted service', removed.name)
      return removed
    })
  }

  /* ----------------------------- numbers -------------------------------- */

  listNumbers(): Promise<TrackingNumber[]> {
    return this.read((workspace) => workspace.numbers)
  }

  async createNumber(input: NewNumber): Promise<TrackingNumber> {
    return this.mutate((workspace) => {
      const number = input.number.trim()
      if (!/\d{3}-?\d{3}-?\d{4}/.test(number)) {
        throw new Error('Enter a US number in 800-555-0100 format.')
      }
      if (workspace.numbers.some((row) => row.number === number)) {
        throw new Error(`The number ${number} is already assigned to a service.`)
      }
      const record: TrackingNumber = {
        ...input,
        number,
        id: makeId('num'),
        createdAt: now(),
        updatedAt: now(),
      }
      workspace.numbers.push(record)
      this.pushActivity(workspace, 'Added tracking number', `${record.number} (${record.label})`)
      return record
    })
  }

  async updateNumber(id: string, patch: Partial<TrackingNumber>): Promise<TrackingNumber> {
    return this.mutate((workspace) => {
      const record = workspace.numbers.find((row) => row.id === id)
      if (!record) throw new Error('Tracking number not found.')
      if (patch.number && patch.number !== record.number) {
        if (workspace.numbers.some((row) => row.number === patch.number && row.id !== id)) {
          throw new Error(`The number ${patch.number} is already assigned to a service.`)
        }
      }
      Object.assign(record, patch, { updatedAt: now() })
      this.pushActivity(workspace, 'Updated tracking number', record.number)
      return record
    })
  }

  async deleteNumber(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.numbers.findIndex((row) => row.id === id)
      if (index === -1) throw new Error('Tracking number not found.')
      const [removed] = workspace.numbers.splice(index, 1)
      this.pushActivity(workspace, 'Deleted tracking number', removed.number)
      return removed
    })
  }

  /* ------------------------------ niches -------------------------------- */

  listNiches(): Promise<NicheRecord[]> {
    return this.read((workspace) => workspace.niches)
  }

  async createNiche(input: NewNiche): Promise<NicheRecord> {
    return this.mutate((workspace) => {
      const slug = normaliseSlug(input.slug || input.name)
      if (!slug) throw new Error('A niche slug is required.')
      if (workspace.niches.some((niche) => niche.slug === slug)) {
        throw new Error(`A niche with the slug “${slug}” already exists.`)
      }
      const record: NicheRecord = { ...input, slug, id: makeId('niche'), createdAt: now() }
      workspace.niches.push(record)
      this.pushActivity(workspace, 'Created niche', record.name)
      return record
    })
  }

  async updateNiche(id: string, patch: Partial<NicheRecord>): Promise<NicheRecord> {
    return this.mutate((workspace) => {
      const record = workspace.niches.find((niche) => niche.id === id)
      if (!record) throw new Error('Niche not found.')
      Object.assign(record, patch)
      this.pushActivity(workspace, 'Updated niche', record.name)
      return record
    })
  }

  async deleteNiche(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.niches.findIndex((niche) => niche.id === id)
      if (index === -1) throw new Error('Niche not found.')
      const [removed] = workspace.niches.splice(index, 1)
      workspace.services.forEach((service) => {
        if (service.nicheId === id) service.nicheId = null
      })
      this.pushActivity(workspace, 'Deleted niche', removed.name)
      return removed
    })
  }

  /* ------------------------------- pages -------------------------------- */

  listPages(): Promise<PageRecord[]> {
    return this.read((workspace) => workspace.pages)
  }

  async createPage(input: NewPage): Promise<PageRecord> {
    return this.mutate((workspace) => {
      const slug = input.slug.startsWith('/') ? input.slug.trim() : `/${normaliseSlug(input.slug || input.title)}`
      if (slug.length < 2) throw new Error('A page path is required.')
      if (workspace.pages.some((page) => page.slug === slug)) {
        throw new Error(`A page already exists at ${slug}.`)
      }
      const record: PageRecord = {
        ...input,
        slug,
        id: makeId('page'),
        updatedAt: now(),
        updatedBy: 'Demo Administrator',
      }
      workspace.pages.push(record)
      this.pushActivity(workspace, 'Created page', record.title)
      return record
    })
  }

  async updatePage(id: string, patch: Partial<PageRecord>): Promise<PageRecord> {
    return this.mutate((workspace) => {
      const record = workspace.pages.find((page) => page.id === id)
      if (!record) throw new Error('Page not found.')
      Object.assign(record, patch, { updatedAt: now(), updatedBy: 'Demo Administrator' })
      this.pushActivity(workspace, 'Updated page', record.title)
      return record
    })
  }

  async deletePage(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.pages.findIndex((page) => page.id === id)
      if (index === -1) throw new Error('Page not found.')
      const [removed] = workspace.pages.splice(index, 1)
      this.pushActivity(workspace, 'Deleted page', removed.title)
      return removed
    })
  }

  /* -------------------------------- blog -------------------------------- */

  listPosts(): Promise<BlogPost[]> {
    return this.read((workspace) => workspace.posts)
  }

  async createPost(input: NewPost): Promise<BlogPost> {
    return this.mutate((workspace) => {
      const slug = normaliseSlug(input.slug || input.title)
      if (workspace.posts.some((post) => post.slug === slug)) {
        throw new Error(`A post with the slug “${slug}” already exists.`)
      }
      const record: BlogPost = { ...input, slug, id: makeId('post'), updatedAt: now() }
      workspace.posts.push(record)
      this.pushActivity(workspace, 'Created post', record.title)
      return record
    })
  }

  async updatePost(id: string, patch: Partial<BlogPost>): Promise<BlogPost> {
    return this.mutate((workspace) => {
      const record = workspace.posts.find((post) => post.id === id)
      if (!record) throw new Error('Post not found.')
      Object.assign(record, patch, { updatedAt: now() })
      this.pushActivity(workspace, 'Updated post', record.title)
      return record
    })
  }

  async deletePost(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.posts.findIndex((post) => post.id === id)
      if (index === -1) throw new Error('Post not found.')
      const [removed] = workspace.posts.splice(index, 1)
      this.pushActivity(workspace, 'Deleted post', removed.title)
      return removed
    })
  }

  /* ---------------------------- home sections --------------------------- */

  listSections(): Promise<HomepageSection[]> {
    return this.read((workspace) => [...workspace.sections].sort((a, b) => a.sortOrder - b.sortOrder))
  }

  async updateSection(id: string, patch: Partial<HomepageSection>): Promise<HomepageSection> {
    return this.mutate((workspace) => {
      const record = workspace.sections.find((section) => section.id === id)
      if (!record) throw new Error('Section not found.')
      Object.assign(record, patch)
      this.pushActivity(workspace, 'Updated section', record.name)
      return record
    })
  }

  async moveSection(id: string, direction: 'up' | 'down'): Promise<HomepageSection[]> {
    return this.mutate((workspace) => {
      const ordered = [...workspace.sections].sort((a, b) => a.sortOrder - b.sortOrder)
      const index = ordered.findIndex((section) => section.id === id)
      const target = direction === 'up' ? index - 1 : index + 1
      if (index === -1 || target < 0 || target >= ordered.length) return ordered
      const current = ordered[index]
      const swap = ordered[target]
      const currentOrder = current.sortOrder
      current.sortOrder = swap.sortOrder
      swap.sortOrder = currentOrder
      const reordered = [...ordered].sort((a, b) => a.sortOrder - b.sortOrder)
      workspace.sections = reordered
      return reordered
    })
  }

  async createSection(input: Omit<HomepageSection, 'id'>): Promise<HomepageSection> {
    return this.mutate((workspace) => {
      const record: HomepageSection = { ...input, id: makeId('sec') }
      workspace.sections.push(record)
      this.pushActivity(workspace, 'Created section', record.name)
      return record
    })
  }

  async deleteSection(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.sections.findIndex((section) => section.id === id)
      if (index === -1) throw new Error('Section not found.')
      const [removed] = workspace.sections.splice(index, 1)
      this.pushActivity(workspace, 'Deleted section', removed.name)
      return removed
    })
  }

  /* -------------------------------- leads ------------------------------- */

  listLeads(): Promise<LeadRecord[]> {
    return this.read((workspace) => [...workspace.leads].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  }

  async updateLead(id: string, patch: Partial<LeadRecord>): Promise<LeadRecord> {
    return this.mutate((workspace) => {
      const record = workspace.leads.find((lead) => lead.id === id)
      if (!record) throw new Error('Lead not found.')
      Object.assign(record, patch)
      this.pushActivity(workspace, 'Updated lead', `${record.name} — ${record.status}`)
      return record
    })
  }

  async deleteLead(id: string): Promise<void> {
    await this.mutate((workspace) => {
      const index = workspace.leads.findIndex((lead) => lead.id === id)
      if (index === -1) throw new Error('Lead not found.')
      const [removed] = workspace.leads.splice(index, 1)
      this.pushActivity(workspace, 'Deleted lead', removed.name)
      return removed
    })
  }

  /* ------------------------------ settings ------------------------------ */

  getSettings(): Promise<SiteSettings> {
    return this.read((workspace) => workspace.settings)
  }

  async updateSettings(patch: Partial<SiteSettings>): Promise<SiteSettings> {
    return this.mutate((workspace) => {
      workspace.settings = { ...workspace.settings, ...patch, updatedAt: now() }
      this.pushActivity(workspace, 'Updated website settings', workspace.settings.siteName)
      return workspace.settings
    })
  }

  getSeo(): Promise<SeoSettings> {
    return this.read((workspace) => workspace.seo)
  }

  async updateSeo(patch: Partial<SeoSettings>): Promise<SeoSettings> {
    return this.mutate((workspace) => {
      workspace.seo = { ...workspace.seo, ...patch, updatedAt: now() }
      this.pushActivity(workspace, 'Updated SEO settings', 'Global defaults')
      return workspace.seo
    })
  }

  /* ------------------------------ activity ------------------------------ */

  listActivity(): Promise<ActivityEntry[]> {
    return this.read((workspace) => workspace.activity.slice(0, 30))
  }

  async logActivity(action: string, target: string, actor = 'Demo Administrator'): Promise<void> {
    await this.mutate((workspace) => {
      this.pushActivity(workspace, action, target, actor)
    })
  }

  private pushActivity(workspace: AdminWorkspace, action: string, target: string, actor = 'Demo Administrator'): void {
    workspace.activity.unshift({
      id: makeId('act'),
      actor,
      action,
      target,
      at: now(),
    })
    workspace.activity = workspace.activity.slice(0, 60)
  }
}

export const localRepository: AdminRepository = new LocalStorageRepository()

/**
 * The single repository the UI imports. Phase 2 changes this line (or the
 * factory below) and nothing else:
 *
 *     export const repository = ADMIN_CONFIG.api.enabled
 *       ? createApiRepository()
 *       : localRepository
 */
export const repository: AdminRepository = localRepository

export const isDemoRepository = repository.mode === 'local'

/** Exposed for tests and for the "reset demo data" action. */
export const resetAdminDemoData = (): Promise<AdminWorkspace> => repository.resetDemoData()
