/**
 * Admin resource descriptors.
 *
 * One declarative table drives the generic CRUD manager, so every editable module gets
 * identical validation, confirmation, search, pagination and audit behaviour instead of
 * eight hand-written forms with eight different bugs.
 *
 * Field types map to controls:
 *   text | textarea | rich | number | boolean | select | tags | json | reference | media
 *
 * `sanitize` marks fields whose HTML must pass through the sanitiser before saving.
 */

export type FieldType =
  | "text"
  | "textarea"
  | "rich"
  | "number"
  | "boolean"
  | "select"
  | "tags"
  | "json"
  | "reference"
  | "media";

/**
 * Foreign-key descriptor for `reference` fields.
 *
 * The options are loaded from the referenced table at edit time, so an administrator picks a
 * provider/industry/category by name instead of pasting a UUID. A reference is *not* a
 * constraint: the database foreign key is the authority, and a failed option load leaves the
 * current value editable as text rather than silently blanking it.
 */
export type AdminReference = {
  table: string;
  valueColumn: string;
  labelColumn: string;
  /** Only offer rows matching these equality filters, e.g. {enabled: "true"}. */
  filter?: Record<string, string>;
  orderBy?: { column: string; ascending: boolean };
  /** Shown when the referenced table has no usable rows. */
  emptyHint?: string;
};

/**
 * Image field descriptor (`type: "media"`).
 *
 * The stored value is a public URL, so the field still works if storage is never configured
 * and a URL is pasted by hand. When the media library is available, a picker offers the
 * uploaded images instead — and `altKey` names the sibling field that should receive the
 * image's alt text, which is what stops a cover image being saved without one.
 */
export type AdminMediaField = {
  /** Field that holds the alt text for this image, e.g. "cover_image_alt". */
  altKey?: string;
  /**
   * Suggested pixel size, shown in the picker. Display-only: nothing is resized or verified,
   * so it must not read like a guarantee.
   */
  recommended?: string;
};

export type AdminField = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  help?: string;
  options?: Array<{ value: string; label: string }>;
  placeholder?: string;
  /** Text fields only. */
  maxLength?: number;
  /** Number fields only. */
  min?: number;
  max?: number;
  /** Treat as HTML and sanitise before saving. */
  sanitize?: boolean;
  /** Hide from the list view (still editable). */
  hideInList?: boolean;
  /** Read-only after creation (primary keys). */
  immutable?: boolean;
  /** Options source for `reference` fields. */
  reference?: AdminReference;
  /** Picker configuration for `media` fields. */
  media?: AdminMediaField;
  /**
   * Empty string is stored as SQL NULL. Required for nullable uuid references, where an empty
   * string would be a type error rather than "no parent".
   */
  nullable?: boolean;
  defaultValue?: string | number | boolean | string[];
};

export type AdminResource = {
  key: string;
  table: string;
  label: string;
  singular: string;
  description: string;
  /** Columns used for the list view. */
  listColumns: Array<{ key: string; label: string; width?: string; mono?: boolean; badge?: boolean }>;
  fields: AdminField[];
  searchColumns: string[];
  orderBy: { column: string; ascending: boolean };
  /**
   * Columns that identify a row for updates and deletes. Defaults to the immutable field
   * (or `id`). Tables with composite primary keys (e.g. scoring_profiles → id + version)
   * list every part here so an update can never touch a sibling version.
   */
  identityKeys?: string[];
  /** Columns that are never sent back to the database on update. */
  readonlyKeys?: string[];
  /** Extra warning shown in the editor. */
  warning?: string;
};

const STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

export const ADMIN_RESOURCES: AdminResource[] = [
  {
    key: "pages",
    table: "pages",
    label: "Pages",
    singular: "page",
    description: "Static pages rendered at /{slug}. Body HTML is sanitised on save and again at render.",
    listColumns: [
      { key: "title", label: "Title" },
      { key: "slug", label: "Slug", mono: true },
      { key: "status", label: "Status", badge: true },
      { key: "updated_at", label: "Updated" },
    ],
    fields: [
      { key: "slug", label: "Slug", type: "text", required: true, immutable: true, help: "Lower-case, hyphen-separated. Changing it later creates a redirect requirement." },
      { key: "title", label: "Title", type: "text", required: true, maxLength: 140 },
      { key: "excerpt", label: "Excerpt", type: "textarea", maxLength: 300 },
      { key: "body", label: "Body", type: "rich", sanitize: true },
      { key: "seo_title", label: "SEO title", type: "text", maxLength: 70, hideInList: true },
      { key: "meta_description", label: "Meta description", type: "textarea", maxLength: 170, hideInList: true },
      {
        key: "og_image_url",
        label: "Social share image",
        type: "media",
        hideInList: true,
        media: { recommended: "1200 × 630" },
        help: "Shown when this page is shared. Falls back to the site default when blank.",
      },
      { key: "status", label: "Status", type: "select", options: STATUS_OPTIONS, defaultValue: "draft" },
      { key: "noindex", label: "Exclude from search engines", type: "boolean", defaultValue: false, hideInList: true },
    ],
    searchColumns: ["title", "slug"],
    orderBy: { column: "updated_at", ascending: false },
    readonlyKeys: ["updated_at", "created_at"],
    warning: "Publishing changes the database, but static hosting serves the content baked at build time — rebuild to publish.",
  },
  {
    key: "posts",
    table: "posts",
    label: "Blog posts",
    singular: "post",
    description: "Articles at /blog/{slug}. Only published posts with a past date appear publicly and in the sitemap.",
    listColumns: [
      { key: "title", label: "Title" },
      { key: "slug", label: "Slug", mono: true },
      { key: "status", label: "Status", badge: true },
      { key: "published_at", label: "Published" },
    ],
    fields: [
      { key: "slug", label: "Slug", type: "text", required: true, immutable: true },
      { key: "title", label: "Title", type: "text", required: true, maxLength: 160 },
      { key: "excerpt", label: "Excerpt", type: "textarea", maxLength: 320 },
      { key: "body", label: "Body", type: "rich", sanitize: true },
      { key: "author_name", label: "Author name", type: "text", maxLength: 80 },
      {
        key: "category_id",
        label: "Category",
        type: "reference",
        nullable: true,
        hideInList: true,
        reference: {
          table: "post_categories",
          valueColumn: "id",
          labelColumn: "name",
          orderBy: { column: "name", ascending: true },
          emptyHint: "No categories yet — the post can be saved without one.",
        },
      },
      { key: "status", label: "Status", type: "select", options: [...STATUS_OPTIONS, { value: "scheduled", label: "Scheduled" }], defaultValue: "draft" },
      { key: "published_at", label: "Publish date/time (ISO)", type: "text", help: "Required when publishing. Example: 2026-01-31T09:00:00Z", hideInList: true },
      { key: "seo_title", label: "SEO title", type: "text", maxLength: 70, hideInList: true },
      { key: "meta_description", label: "Meta description", type: "textarea", maxLength: 170, hideInList: true },
      {
        key: "cover_image_url",
        label: "Cover image",
        type: "media",
        hideInList: true,
        media: { altKey: "cover_image_alt", recommended: "1600 × 900" },
        help: "Pick from the media library, or paste any public URL. Choosing an image fills the alt text below when it is empty.",
      },
      { key: "cover_image_alt", label: "Cover image alt text", type: "text", maxLength: 160, hideInList: true, help: "Required whenever a cover image is set — the SEO diagnostics screen reports it as an error otherwise." },
      {
        key: "og_image_url",
        label: "Social share image",
        type: "media",
        hideInList: true,
        media: { recommended: "1200 × 630" },
        help: "Falls back to the site default when blank.",
      },
      { key: "reading_minutes", label: "Reading minutes", type: "number", min: 0, max: 120, hideInList: true },
      { key: "noindex", label: "Exclude from search engines", type: "boolean", defaultValue: false, hideInList: true },
    ],
    searchColumns: ["title", "slug"],
    orderBy: { column: "published_at", ascending: false },
    readonlyKeys: ["created_at", "updated_at"],
  },
  {
    key: "industries",
    table: "industries",
    label: "Industries",
    singular: "industry",
    description: "Industry dictionary used for semantic expansion and /industries landing pages.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "slug", label: "Slug", mono: true },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "display_order", label: "Order" },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true, help: "Stable identifier used by the engine and existing URLs." },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true },
      {
        key: "parent_id",
        label: "Parent industry",
        type: "reference",
        nullable: true,
        hideInList: true,
        reference: {
          table: "industries",
          valueColumn: "id",
          labelColumn: "name",
          orderBy: { column: "display_order", ascending: true },
        },
      },
      { key: "description", label: "Description", type: "textarea" },
      { key: "intro", label: "Landing page intro", type: "textarea", sanitize: true, help: "Plain text or limited HTML; sanitised on save." },
      { key: "semantic_weight", label: "Semantic weight", type: "number", min: 0, max: 5 },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "display_order", label: "Display order", type: "number", min: 0, max: 9999, hideInList: true },
      { key: "seo_title", label: "SEO title", type: "text", maxLength: 70, hideInList: true },
      { key: "meta_description", label: "Meta description", type: "textarea", maxLength: 170, hideInList: true },
    ],
    searchColumns: ["name", "slug"],
    orderBy: { column: "display_order", ascending: true },
  },
  {
    key: "tlds",
    table: "tlds",
    label: "Domain extensions",
    singular: "extension",
    description: "TLD directory. Checkability is a capability statement, not a promise that a check will succeed.",
    listColumns: [
      { key: "tld", label: "TLD", mono: true },
      { key: "display_name", label: "Display" },
      { key: "checkability", label: "Checkability", badge: true },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "tld", label: "TLD", type: "text", required: true, immutable: true, help: "Without the leading dot." },
      { key: "display_name", label: "Display name", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      {
        key: "category",
        label: "Category",
        type: "select",
        options: ["generic", "technology", "business", "country", "media", "social"].map((value) => ({ value, label: value })),
        defaultValue: "generic",
      },
      {
        key: "checkability",
        label: "Checkability",
        type: "select",
        options: [
          { value: "rdap", label: "RDAP" },
          { value: "registrar-api", label: "Registrar API" },
          { value: "unknown", label: "Unknown" },
          { value: "unsupported", label: "Unsupported" },
        ],
        defaultValue: "unknown",
      },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "display_order", label: "Display order", type: "number", min: 0, max: 9999, hideInList: true },
      { key: "note", label: "Public note", type: "textarea", hideInList: true, help: "Shown in the extension directory. Use it for honest limitations." },
    ],
    searchColumns: ["tld", "display_name"],
    orderBy: { column: "display_order", ascending: true },
  },
  {
    key: "dictionary-terms",
    table: "dictionary_terms",
    label: "Dictionary",
    singular: "term",
    description: "Words the naming engine may combine with a root. Changes affect new generations immediately.",
    listColumns: [
      { key: "word", label: "Word", mono: true },
      { key: "term_type", label: "Type", badge: true },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "weight", label: "Weight" },
    ],
    fields: [
      { key: "word", label: "Word", type: "text", required: true, maxLength: 40 },
      {
        key: "term_type",
        label: "Type",
        type: "select",
        options: ["word", "prefix", "suffix", "morpheme", "synonym", "excluded"].map((value) => ({ value, label: value })),
        defaultValue: "word",
      },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "weight", label: "Weight", type: "number", min: 0, max: 10, hideInList: true },
      { key: "notes", label: "Notes", type: "textarea", hideInList: true },
    ],
    searchColumns: ["word"],
    orderBy: { column: "word", ascending: true },
  },
  {
    key: "ad-slots",
    table: "ad_slots",
    label: "Ad placements",
    singular: "placement",
    description: "Advertising slots. Nothing renders until a publisher ID is set and the slot is enabled.",
    listColumns: [
      { key: "slot_key", label: "Slot", mono: true },
      { key: "template", label: "Template" },
      { key: "placement", label: "Position" },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "slot_key", label: "Slot key", type: "text", required: true, immutable: true },
      {
        key: "template",
        label: "Template",
        type: "select",
        options: ["home", "generator", "industry", "blog-index", "blog-post", "page", "tld"].map((value) => ({ value, label: value })),
        required: true,
      },
      {
        key: "placement",
        label: "Placement",
        type: "select",
        options: ["after-intro", "mid-content", "before-faq", "end-of-content", "sidebar"].map((value) => ({ value, label: value })),
        required: true,
      },
      {
        key: "format",
        label: "Format",
        type: "select",
        options: ["auto", "horizontal", "rectangle", "vertical"].map((value) => ({ value, label: value })),
        defaultValue: "auto",
      },
      { key: "ad_unit_id", label: "Ad unit ID", type: "text", help: "Numeric AdSense unit ID. Leave empty until the unit exists." },
      { key: "label", label: "Visible label", type: "text", defaultValue: "Advertisement" },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: false },
      { key: "display_order", label: "Display order", type: "number", min: 0, max: 9999, hideInList: true },
    ],
    searchColumns: ["slot_key", "template"],
    orderBy: { column: "display_order", ascending: true },
    warning: "Never place ads where they could be mistaken for generator controls or availability results.",
  },
  {
    key: "affiliates",
    table: "affiliate_providers",
    label: "Affiliate providers",
    singular: "provider",
    description: "Registrar routing. Templates must be https, contain {domain} and stay inside the allowed hosts.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "slug", label: "Slug", mono: true },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "priority", label: "Priority" },
    ],
    fields: [
      { key: "name", label: "Name", type: "text", required: true },
      { key: "slug", label: "Slug", type: "text", required: true, immutable: true },
      { key: "url_template", label: "URL template", type: "text", required: true, help: "https://registrar.example/search?domain={domain}" },
      { key: "allowed_hosts", label: "Allowed hosts", type: "tags", required: true, help: "Redirect targets are rejected unless their host is listed here." },
      { key: "supported_tlds", label: "Supported TLDs", type: "tags", help: "Empty means all extensions." },
      { key: "disclosure", label: "Disclosure text", type: "textarea" },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: false },
      { key: "is_fallback", label: "Fallback provider", type: "boolean", defaultValue: false, hideInList: true },
      { key: "priority", label: "Priority", type: "number", min: 0, max: 999, hideInList: true },
    ],
    searchColumns: ["name", "slug"],
    orderBy: { column: "priority", ascending: true },
    warning: "Destinations are validated against the allowed hosts list to prevent open redirects.",
  },
  {
    key: "affiliate-rules",
    table: "affiliate_tld_rules",
    label: "Affiliate extension rules",
    singular: "extension rule",
    description:
      "Maps an extension to the provider that should handle clicks for it. An explicit rule beats a provider's supported-TLD list.",
    listColumns: [
      { key: "tld", label: "Extension", mono: true },
      { key: "provider_id", label: "Provider", mono: true },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "tld", label: "Extension", type: "text", required: true, immutable: true, help: "Lower-case, no leading dot. Example: com" },
      {
        key: "provider_id",
        label: "Provider",
        type: "reference",
        required: true,
        immutable: true,
        reference: {
          table: "affiliate_providers",
          valueColumn: "id",
          labelColumn: "name",
          orderBy: { column: "priority", ascending: true },
          emptyHint: "Create an affiliate provider first — a rule with no provider routes nowhere.",
        },
      },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    identityKeys: ["tld", "provider_id"],
    searchColumns: ["tld"],
    orderBy: { column: "tld", ascending: true },
    warning:
      "Rules only take effect when the provider is enabled and the affiliate_routing flag is on. Clicks are re-validated server-side.",
  },
  {
    key: "redirects",
    table: "redirects",
    label: "Redirects",
    singular: "redirect",
    description: "Path redirects emitted for the static host (.htaccess / _redirects) at build time.",
    listColumns: [
      { key: "source_path", label: "From", mono: true },
      { key: "target_path", label: "To", mono: true },
      { key: "status_code", label: "Code" },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "source_path", label: "Source path", type: "text", required: true, help: "Must start with /" },
      { key: "target_path", label: "Target path", type: "text", required: true },
      {
        key: "status_code",
        label: "Status code",
        type: "select",
        options: ["301", "302", "307", "308"].map((value) => ({ value, label: value })),
        defaultValue: "301",
      },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    searchColumns: ["source_path", "target_path"],
    orderBy: { column: "created_at", ascending: false },
  },
  {
    key: "seo-templates",
    table: "seo_templates",
    label: "SEO templates",
    singular: "template",
    description: "Title and description patterns per page type. Placeholders: {{title}}, {{site}}, {{industry}}, {{tld}}, {{excerpt}}.",
    listColumns: [
      { key: "entity", label: "Entity", mono: true },
      { key: "title_template", label: "Title template" },
      { key: "updated_at", label: "Updated" },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true },
      {
        key: "entity",
        label: "Entity",
        type: "select",
        required: true,
        options: [
          { value: "home", label: "Home" },
          { value: "page", label: "Page" },
          { value: "post", label: "Blog post" },
          { value: "industry", label: "Industry landing page" },
          { value: "tld", label: "Extension page" },
          { value: "generator", label: "Generator" },
          { value: "blog-index", label: "Blog index" },
        ],
      },
      { key: "title_template", label: "Title template", type: "text", required: true, maxLength: 200 },
      { key: "description_template", label: "Description template", type: "textarea", required: true, maxLength: 400 },
    ],
    searchColumns: ["entity", "id"],
    orderBy: { column: "entity", ascending: true },
    readonlyKeys: ["updated_at"],
    warning: "Templates are read at build time. Rebuild to publish changes, and keep titles under ~60 characters.",
  },
  {
    key: "word-libraries",
    table: "word_libraries",
    label: "Word libraries",
    singular: "library",
    description: "Prefix and suffix affix pools used by the generator. Disabled libraries stop contributing to new runs.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "kind", label: "Kind", badge: true },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "display_order", label: "Order" },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "kind", label: "Kind", type: "select", required: true, options: [{ value: "prefix", label: "Prefix" }, { value: "suffix", label: "Suffix" }] },
      { key: "description", label: "Description", type: "textarea" },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "display_order", label: "Display order", type: "number", min: 0, max: 9999 },
    ],
    searchColumns: ["name", "id"],
    orderBy: { column: "display_order", ascending: true },
  },
  {
    key: "scoring-profiles",
    table: "scoring_profiles",
    label: "Scoring profiles",
    singular: "scoring profile",
    description:
      "Weighted quality and brandability profiles. Scoring is versioned: create a new version row rather than editing a published one, so historical results stay explainable.",
    listColumns: [
      { key: "id", label: "ID", mono: true },
      { key: "version", label: "Version" },
      { key: "name", label: "Name" },
      { key: "kind", label: "Kind", badge: true },
      { key: "is_active", label: "Active", badge: true },
    ],
    fields: [
      { key: "id", label: "Profile ID", type: "text", required: true, immutable: true, help: "Grouping key. Reuse it for a new version." },
      { key: "version", label: "Version", type: "number", required: true, immutable: true, min: 1, max: 999, defaultValue: 1 },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "kind", label: "Kind", type: "select", required: true, options: [{ value: "quality", label: "Quality" }, { value: "brandability", label: "Brandability" }] },
      { key: "description", label: "Description", type: "textarea" },
      { key: "ideal_length_min", label: "Ideal length min", type: "number", min: 1, max: 63 },
      { key: "ideal_length_max", label: "Ideal length max", type: "number", min: 1, max: 63 },
      {
        key: "weights",
        label: "Weights (JSON object)",
        type: "json",
        required: true,
        help: 'Each weight is a number that must sum to 1. Example: {"pronounceable":0.3,"length":0.2,"memorability":0.25,"cleanliness":0.25}',
      },
      { key: "is_active", label: "Active", type: "boolean", defaultValue: true, help: "Only one version per profile ID should be active." },
    ],
    identityKeys: ["id", "version"],
    searchColumns: ["name", "id"],
    orderBy: { column: "version", ascending: false },
    readonlyKeys: ["created_at", "created_by"],
    warning: "Weights are validated by the engine at load time. An invalid profile is ignored for new requests and reported in the generator diagnostics.",
  },
  {
    key: "brandable-profiles",
    table: "brandable_profiles",
    label: "Brandable profiles",
    singular: "brandable profile",
    description: "Naming briefs for brandable mode: length, syllable range, preferred styles and originality bias.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "ideal_length_min", label: "Min length" },
      { key: "ideal_length_max", label: "Max length" },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
      { key: "ideal_length_min", label: "Ideal length min", type: "number", min: 3, max: 20 },
      { key: "ideal_length_max", label: "Ideal length max", type: "number", min: 3, max: 20 },
      { key: "ideal_syllables_min", label: "Ideal syllables min", type: "number", min: 1, max: 6 },
      { key: "ideal_syllables_max", label: "Ideal syllables max", type: "number", min: 1, max: 6 },
      { key: "preferred_styles", label: "Preferred styles (one of the 12 modes)", type: "tags" },
      { key: "originality_bias", label: "Originality bias (0–1)", type: "number", min: 0, max: 1 },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "display_order", label: "Display order", type: "number", min: 0, max: 9999 },
    ],
    searchColumns: ["name", "id"],
    orderBy: { column: "display_order", ascending: true },
  },
  {
    key: "phrase-templates",
    table: "phrase_templates",
    label: "Phrase templates",
    singular: "phrase template",
    description: "Composition patterns for the Domain Brain (root + industry, root + concept, prefix + root, …).",
    listColumns: [
      { key: "label", label: "Label" },
      { key: "template", label: "Template", mono: true },
      { key: "pool", label: "Pool", mono: true },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true },
      { key: "label", label: "Label", type: "text", required: true },
      {
        key: "template",
        label: "Template",
        type: "select",
        required: true,
        options: [
          { value: "prefix-root", label: "prefix-root" },
          { value: "root-suffix", label: "root-suffix" },
          { value: "industry-root", label: "industry-root" },
          { value: "root-industry", label: "root-industry" },
          { value: "root-concept", label: "root-concept" },
          { value: "root-action", label: "root-action" },
          { value: "root-audience", label: "root-audience" },
          { value: "root-product", label: "root-product" },
        ],
      },
      {
        key: "pool",
        label: "Pool",
        type: "select",
        required: true,
        options: [
          { value: "prefix", label: "prefix" },
          { value: "suffix", label: "suffix" },
          { value: "industry", label: "industry" },
          { value: "concept", label: "concept" },
          { value: "action", label: "action" },
          { value: "audience", label: "audience" },
          { value: "product", label: "product" },
        ],
      },
      {
        key: "industry_id",
        label: "Industry (optional)",
        type: "reference",
        nullable: true,
        help: "Leave blank for all industries.",
        reference: {
          table: "industries",
          valueColumn: "id",
          labelColumn: "name",
          orderBy: { column: "display_order", ascending: true },
        },
      },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    searchColumns: ["label", "id", "template"],
    orderBy: { column: "label", ascending: true },
  },
  {
    key: "excluded-rules",
    table: "excluded_rules",
    label: "Exclusion rules",
    singular: "exclusion rule",
    description:
      "Patterns removed from results before they reach the user — trademarks, awkward letter pairs, banned terms. Block hides a name; warn keeps it with a flag.",
    listColumns: [
      { key: "pattern", label: "Pattern", mono: true },
      { key: "match_type", label: "Match", badge: true },
      { key: "severity", label: "Severity", badge: true },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", immutable: true, help: "Leave blank to let the database generate one." },
      { key: "pattern", label: "Pattern", type: "text", required: true, maxLength: 120 },
      {
        key: "match_type",
        label: "Match type",
        type: "select",
        required: true,
        options: [
          { value: "substring", label: "Substring" },
          { value: "word", label: "Whole word" },
          { value: "regex", label: "Regular expression" },
        ],
      },
      { key: "severity", label: "Severity", type: "select", required: true, options: [{ value: "block", label: "Block" }, { value: "warn", label: "Warn" }] },
      { key: "reason", label: "Reason", type: "textarea", maxLength: 240 },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    searchColumns: ["pattern"],
    orderBy: { column: "created_at", ascending: false },
    warning: "Regex rules run against every candidate: a pathological pattern can slow generation. Invalid regexes are skipped and logged in diagnostics.",
  },
  {
    key: "availability-providers",
    table: "availability_providers",
    label: "Availability providers",
    singular: "provider",
    description: "RDAP endpoints and check policies. Only real, documented endpoints belong here — no scraping sources.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "kind", label: "Kind", badge: true },
      { key: "priority", label: "Priority" },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "is_production", label: "Production", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true },
      { key: "name", label: "Name", type: "text", required: true },
      {
        key: "kind",
        label: "Kind",
        type: "select",
        required: true,
        options: [
          { value: "rdap", label: "RDAP" },
          { value: "dns", label: "DNS" },
          { value: "registrar-api", label: "Registrar API" },
          { value: "edge-function", label: "Edge function" },
          { value: "mock", label: "Mock (never production)" },
        ],
      },
      { key: "base_url", label: "Base URL", type: "text", placeholder: "https://rdap.example/" },
      { key: "endpoint_template", label: "Endpoint template", type: "text", placeholder: "{base}{domain}" },
      { key: "supports_tlds", label: "Supported TLDs", type: "tags", help: "Comma separated, no leading dot. Empty means none." },
      { key: "priority", label: "Priority", type: "number", min: 1, max: 999 },
      { key: "timeout_ms", label: "Timeout (ms)", type: "number", min: 1000, max: 30000 },
      { key: "rate_limit_per_minute", label: "Rate limit / minute", type: "number", min: 1, max: 600 },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
      { key: "is_production", label: "Production", type: "boolean", defaultValue: true },
      { key: "notes", label: "Notes", type: "textarea" },
    ],
    searchColumns: ["name", "id"],
    orderBy: { column: "priority", ascending: true },
    warning: "A provider marked `mock` must never be production-enabled: the engine reports its results as unverified, not available.",
  },
  {
    key: "feature-flags",
    table: "feature_flags",
    label: "Feature flags",
    singular: "flag",
    description: "Optional capabilities. Every AI or paid-API feature must remain off by default; the core generator works with all flags disabled.",
    listColumns: [
      { key: "key", label: "Key", mono: true },
      { key: "enabled", label: "Enabled", badge: true },
      { key: "description", label: "Description" },
    ],
    fields: [
      { key: "key", label: "Key", type: "text", required: true, immutable: true, help: "Stable identifier read by the app, e.g. ai_content_studio." },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: false },
      { key: "description", label: "Description", type: "textarea" },
    ],
    searchColumns: ["key"],
    orderBy: { column: "key", ascending: true },
  },
  {
    key: "post-categories",
    table: "post_categories",
    label: "Blog categories",
    singular: "category",
    description: "Categories used to group blog posts.",
    listColumns: [
      { key: "name", label: "Name" },
      { key: "slug", label: "Slug", mono: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", immutable: true, help: "Leave blank to let the database generate one." },
      { key: "slug", label: "Slug", type: "text", required: true, immutable: true },
      { key: "name", label: "Name", type: "text", required: true },
      { key: "description", label: "Description", type: "textarea" },
    ],
    searchColumns: ["name", "slug"],
    orderBy: { column: "name", ascending: true },
  },
  {
    key: "ad-settings",
    table: "ad_settings",
    label: "Ad settings",
    singular: "ad configuration",
    description:
      "Global advertising switches. The publisher ID format is enforced by the database. Ads never render unless a slot is also enabled.",
    listColumns: [
      { key: "provider", label: "Provider", badge: true },
      { key: "publisher_id", label: "Publisher ID", mono: true },
      { key: "global_enabled", label: "Enabled", badge: true },
      { key: "test_mode", label: "Test mode", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true, defaultValue: "global" },
      { key: "provider", label: "Provider", type: "select", required: true, options: [{ value: "adsense", label: "AdSense" }, { value: "none", label: "None" }], defaultValue: "none" },
      { key: "publisher_id", label: "Publisher ID", type: "text", placeholder: "ca-pub-0000000000000000" },
      { key: "script_enabled", label: "Load provider script", type: "boolean", defaultValue: false },
      { key: "global_enabled", label: "Serve ads site-wide", type: "boolean", defaultValue: false },
      { key: "test_mode", label: "Test mode (no billable impressions)", type: "boolean", defaultValue: true },
      { key: "consent_required", label: "Require consent before loading", type: "boolean", defaultValue: true },
    ],
    identityKeys: ["id"],
    searchColumns: ["id"],
    orderBy: { column: "id", ascending: true },
    readonlyKeys: ["updated_by", "updated_at"],
    warning: "No arbitrary JavaScript can be added here. Slots reference ad-unit IDs only.",
  },
  {
    key: "nav-menus",
    table: "nav_menus",
    label: "Navigation menus",
    singular: "menu",
    description:
      "Menu containers. `location` decides where one renders (header or footer) and `position` decides column order. Changes take effect on the next rebuild — the site is a static export.",
    listColumns: [
      { key: "id", label: "ID", mono: true },
      { key: "name", label: "Heading" },
      { key: "location", label: "Location", badge: true },
      { key: "position", label: "Order" },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "id", label: "ID", type: "text", required: true, immutable: true, help: "Stable identifier, e.g. footer-company. Links reference it." },
      { key: "name", label: "Heading", type: "text", required: true, help: "Shown above the column in the footer. The primary menu's name is not displayed." },
      {
        key: "location",
        label: "Location",
        type: "select",
        options: [
          { value: "primary", label: "Header" },
          { value: "footer", label: "Footer column" },
          { value: "admin", label: "Admin sidebar (unused)" },
        ],
        defaultValue: "footer",
      },
      { key: "position", label: "Order", type: "number", min: 0, max: 9999, defaultValue: 100, help: "Lower sorts first. Ties fall back to the ID so exports stay stable." },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    identityKeys: ["id"],
    searchColumns: ["id", "name"],
    orderBy: { column: "position", ascending: true },
    readonlyKeys: ["updated_at"],
  },
  {
    key: "nav-items",
    table: "nav_items",
    label: "Menu items",
    singular: "menu item",
    description:
      "Individual links. Internal paths must start with / (the SEO diagnostics screen reports any that resolve to nothing). Changes appear after the next rebuild.",
    listColumns: [
      { key: "menu_id", label: "Menu", mono: true },
      { key: "label", label: "Label" },
      { key: "href", label: "Link", mono: true },
      { key: "position", label: "Order" },
      { key: "enabled", label: "Enabled", badge: true },
    ],
    fields: [
      { key: "menu_id", label: "Menu", type: "reference", required: true, reference: { table: "nav_menus", valueColumn: "id", labelColumn: "name", orderBy: { column: "position", ascending: true } } },
      { key: "label", label: "Label", type: "text", required: true, maxLength: 40 },
      {
        key: "href",
        label: "Link",
        type: "text",
        required: true,
        placeholder: "/generator",
        help: "Internal path starting with /, or an absolute https:// URL. Query strings and #fragments are allowed.",
      },
      { key: "description", label: "Description", type: "textarea", maxLength: 120, hideInList: true, help: "Shown in the mobile menu and as a title attribute on hover." },
      { key: "position", label: "Order", type: "number", min: 0, max: 9999, defaultValue: 100 },
      { key: "enabled", label: "Enabled", type: "boolean", defaultValue: true },
    ],
    searchColumns: ["label", "href"],
    orderBy: { column: "position", ascending: true },
    readonlyKeys: ["created_at"],
    warning:
      "The header and footer are generated at build time. A saved change is live only after the next deploy.",
  },
];

export function getResource(key: string): AdminResource | undefined {
  return ADMIN_RESOURCES.find((resource) => resource.key === key);
}

/** Navigation groups used by the admin sidebar. */
export const ADMIN_NAV: Array<{ heading: string; items: Array<{ label: string; href: string; resource?: string }> }> = [
  {
    heading: "Overview",
    items: [
      { label: "Dashboard", href: "/admin/" },
      { label: "Analytics", href: "/admin/analytics/" },
      { label: "Audit log", href: "/admin/audit/" },
    ],
  },
  {
    heading: "Domain brain",
    items: [
      { label: "Dictionary", href: "/admin/dictionary-terms/", resource: "dictionary-terms" },
      { label: "Word libraries", href: "/admin/word-libraries/", resource: "word-libraries" },
      { label: "Phrase templates", href: "/admin/phrase-templates/", resource: "phrase-templates" },
      { label: "Industries", href: "/admin/industries/", resource: "industries" },
    ],
  },
  {
    heading: "Naming & scoring",
    items: [
      { label: "Scoring profiles", href: "/admin/scoring-profiles/", resource: "scoring-profiles" },
      { label: "Brandable profiles", href: "/admin/brandable-profiles/", resource: "brandable-profiles" },
      { label: "Exclusion rules", href: "/admin/excluded-rules/", resource: "excluded-rules" },
    ],
  },
  {
    heading: "Extensions",
    items: [{ label: "Domain extensions", href: "/admin/tlds/", resource: "tlds" }],
  },
  {
    heading: "Availability",
    items: [{ label: "Providers", href: "/admin/availability-providers/", resource: "availability-providers" }],
  },
  {
    heading: "Monetization",
    items: [
      { label: "Affiliate providers", href: "/admin/affiliates/", resource: "affiliates" },
      { label: "Affiliate extension rules", href: "/admin/affiliate-rules/", resource: "affiliate-rules" },
      { label: "Ad placements", href: "/admin/ad-slots/", resource: "ad-slots" },
      { label: "Ad settings", href: "/admin/ad-settings/", resource: "ad-settings" },
    ],
  },
  {
    heading: "Content",
    items: [
      { label: "Pages", href: "/admin/pages/", resource: "pages" },
      { label: "Media library", href: "/admin/media/" },
      { label: "Blog posts", href: "/admin/posts/", resource: "posts" },
      { label: "Blog categories", href: "/admin/post-categories/", resource: "post-categories" },
      { label: "AI studio", href: "/admin/studio/" },
      { label: "Redirects", href: "/admin/redirects/", resource: "redirects" },
    ],
  },
  {
    heading: "Navigation",
    items: [
      { label: "Menu items", href: "/admin/nav-items/", resource: "nav-items" },
      { label: "Menus", href: "/admin/nav-menus/", resource: "nav-menus" },
    ],
  },
  {
    heading: "SEO",
    items: [
      { label: "Diagnostics", href: "/admin/seo/" },
      { label: "SEO templates", href: "/admin/seo-templates/", resource: "seo-templates" },
    ],
  },
  {
    heading: "Access",
    items: [{ label: "Users & roles", href: "/admin/users/" }],
  },
  {
    heading: "System",
    items: [
      { label: "Settings", href: "/admin/settings/" },
      { label: "Feature flags", href: "/admin/feature-flags/", resource: "feature-flags" },
    ],
  },
];

/** Total modules exposed by the admin area, used in the completion report. */
export const ADMIN_MODULE_COUNT = ADMIN_NAV.reduce((sum, group) => sum + group.items.length, 0);
