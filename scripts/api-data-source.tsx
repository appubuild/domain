import { SERVICES, SERVICE_CATEGORIES } from '@/config/services'
import { SITE } from '@/config/site'
import { SERVICE_PHONE_NUMBERS } from '@/data/serviceNumbers'
import { SERVICE_NUMBER_MAP, CALL_DIRECTORY_CATEGORIES } from '@/data/serviceNumberMapping'
import { HOME_FAQS, HOW_IT_WORKS_FAQS } from '@/config/faqs'
import { buildSeedWorkspace } from '@/admin/data/seed'

const seed = buildSeedWorkspace()

globalThis.__SHN_DATA__ = {
  site: SITE,
  categories: SERVICE_CATEGORIES,
  services: SERVICES,
  groups: SERVICE_PHONE_NUMBERS,
  mapping: SERVICE_NUMBER_MAP,
  directory: CALL_DIRECTORY_CATEGORIES,
  faqs: { home: HOME_FAQS, howItWorks: HOW_IT_WORKS_FAQS },
  pages: seed.pages,
  posts: seed.posts,
  sections: seed.sections,
  niches: seed.niches,
}
