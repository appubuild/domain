import { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Check, Copy, Loader2, Mail, Send } from 'lucide-react'
import { Link } from 'react-router-dom'
import { INTEGRATIONS, CONTACT_FORM_CONNECTED } from '@/config/integrations'
import { SITE } from '@/config/site'
import { tracking } from '@/lib/tracking'

type Status = 'idle' | 'submitting' | 'sent' | 'email' | 'error'

interface FormValues {
  name: string
  email: string
  subject: string
  message: string
  consent: boolean
  company: string
}

type FormErrors = Partial<Record<keyof FormValues, string>>

const SUBJECTS = [
  'General question',
  'Availability in my area',
  'Provider listing inquiry',
  'Technical problem with the site',
  'Privacy or data request',
  'Something else',
]

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i

const initialValues: FormValues = {
  name: '',
  email: '',
  subject: '',
  message: '',
  consent: false,
  company: '',
}

const validate = (values: FormValues): FormErrors => {
  const errors: FormErrors = {}
  if (values.name.trim().length < 2) errors.name = 'Please enter your full name.'
  if (!values.email.trim()) errors.email = 'Please enter your email address.'
  else if (!EMAIL_PATTERN.test(values.email.trim())) errors.email = 'Enter a valid email address, e.g. name@example.com.'
  if (!values.subject) errors.subject = 'Please choose a subject.'
  if (values.message.trim().length < 20)
    errors.message = 'Please add a little more detail (at least 20 characters).'
  if (!values.consent) errors.consent = 'Please confirm you agree to be contacted about this request.'
  return errors
}

/**
 * Builds the email that carries the enquiry when no form endpoint is connected,
 * so the visitor still reaches a real inbox instead of a dead end.
 */
const buildEmailBody = (values: FormValues): string =>
  [
    `Name: ${values.name.trim()}`,
    `Email: ${values.email.trim()}`,
    `Topic: ${values.subject}`,
    '',
    values.message.trim(),
    '',
    'I agree to be contacted about this request.',
  ].join('\n')

const buildMailtoHref = (values: FormValues): string =>
  `mailto:${SITE.contact.email}?subject=${encodeURIComponent(
    `Website enquiry — ${values.subject}`,
  )}&body=${encodeURIComponent(buildEmailBody(values))}`

export const ContactForm = () => {
  const [values, setValues] = useState<FormValues>(initialValues)
  const [errors, setErrors] = useState<FormErrors>({})
  const [status, setStatus] = useState<Status>('idle')
  const [mailtoHref, setMailtoHref] = useState('')
  const [copied, setCopied] = useState(false)
  const startedAt = useRef(Date.now())
  const regionRef = useRef<HTMLFormElement>(null)

  const setField = <K extends keyof FormValues>(key: K, value: FormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }))
    setErrors((current) => ({ ...current, [key]: undefined }))
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const nextErrors = validate(values)
    setErrors(nextErrors)

    if (Object.keys(nextErrors).length > 0) {
      regionRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
      return
    }

    // Basic bot signals: a filled honeypot or an instant submit.
    const looksAutomated = Boolean(values.company) || Date.now() - startedAt.current < 1500
    if (looksAutomated) {
      setStatus('error')
      return
    }

    tracking.onContactSubmit({ service: values.subject, path: '/contact' })

    if (!CONTACT_FORM_CONNECTED) {
      // No server endpoint: hand the finished message to the visitor's email
      // app instead of pretending it was delivered from the page.
      const href = buildMailtoHref(values)
      setMailtoHref(href)
      setStatus('email')
      if (typeof window !== 'undefined') window.location.href = href
      return
    }

    setStatus('submitting')
    try {
      const response = await fetch(INTEGRATIONS.contactEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          name: values.name.trim(),
          email: values.email.trim(),
          subject: values.subject,
          message: values.message.trim(),
          consent: values.consent,
          source: 'safehomenetwork.com/contact',
        }),
      })
      if (!response.ok) throw new Error(`Request failed with ${response.status}`)
      setStatus('sent')
      setValues(initialValues)
    } catch {
      setStatus('error')
    }
  }

  if (status === 'sent') {
    return (
      <div className="card p-8 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-50 text-success-700 dark:bg-success-500/15 dark:text-success-300">
          <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
        </div>
        <h2 className="mt-4 font-display text-xl font-extrabold text-ink">Message received</h2>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-6 text-muted">
          Thank you for reaching out. Our team typically replies within one business day. If your request is
          urgent, please contact a local provider or your insurer directly.
        </p>
        <button type="button" onClick={() => setStatus('idle')} className="btn-secondary mt-6">
          Send another message
        </button>
      </div>
    )
  }

  return (
    <div className="card p-6 sm:p-8">
      <h2 className="font-display text-xl font-bold text-ink">Send us a message</h2>
      <p className="mt-1.5 text-sm leading-6 text-muted">
        Tell us what you are working on. We will reply with the options available in your area.
      </p>

      {status === 'email' ? (
        <div className="mt-5 rounded-xl border border-brand-500/30 bg-brand-50/70 p-4 dark:border-brand-400/25 dark:bg-brand-500/10">
          <p className="flex items-center gap-2 text-sm font-bold text-ink dark:text-white">
            <Mail className="h-4 w-4" aria-hidden="true" />
            Your message is ready in your email app
          </p>
          <p className="mt-2 text-[0.8125rem] leading-6 text-ink/80 dark:text-white/80">
            Press send there and it comes straight to our team — we will reply to {' '}
            <span className="font-semibold">{values.email.trim() || 'the address you gave us'}</span>. If
            nothing opened, copy the message and email it to {' '}
            <a
              href={`mailto:${SITE.contact.email}`}
              className="font-semibold underline underline-offset-2"
            >
              {SITE.contact.email}
            </a>
            .
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href={mailtoHref} className="btn-primary btn-sm">
              <Mail className="h-3.5 w-3.5" aria-hidden="true" />
              Open email app
            </a>
            <button
              type="button"
              className="btn-secondary btn-sm"
              onClick={() => {
                void (async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `To: ${SITE.contact.email}\nSubject: Website enquiry — ${values.subject}\n\n${buildEmailBody(values)}`,
                    )
                    setCopied(true)
                    window.setTimeout(() => setCopied(false), 2500)
                  } catch {
                    setCopied(false)
                  }
                })()
              }}
            >
              {copied ? (
                <Check className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy message'}
            </button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setStatus('idle')}>
              Edit message
            </button>
          </div>
        </div>
      ) : null}

      {status === 'error' ? (
        <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-red-500/30 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:text-red-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            We could not send your message. Please try again, or email us at{' '}
            <a href={`mailto:${SITE.contact.email}`} className="font-semibold underline underline-offset-2">
              {SITE.contact.email}
            </a>
            .
          </span>
        </div>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="mt-6" ref={regionRef}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="contact-name" className="label">
              Full name <span className="text-brand-600 dark:text-brand-400">*</span>
            </label>
            <input
              id="contact-name"
              name="name"
              autoComplete="name"
              value={values.name}
              onChange={(event) => setField('name', event.target.value)}
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'contact-name-error' : undefined}
              placeholder="Jordan Ellis"
              className={`input ${errors.name ? 'border-red-500 focus:border-red-500 focus:ring-red-500/15' : ''}`}
            />
            {errors.name ? (
              <p id="contact-name-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div>
            <label htmlFor="contact-email" className="label">
              Email address <span className="text-brand-600 dark:text-brand-400">*</span>
            </label>
            <input
              id="contact-email"
              name="email"
              type="email"
              autoComplete="email"
              value={values.email}
              onChange={(event) => setField('email', event.target.value)}
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'contact-email-error' : undefined}
              placeholder="you@example.com"
              className={`input ${errors.email ? 'border-red-500 focus:border-red-500 focus:ring-red-500/15' : ''}`}
            />
            {errors.email ? (
              <p id="contact-email-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
                {errors.email}
              </p>
            ) : null}
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor="contact-subject" className="label">
            Subject <span className="text-brand-600 dark:text-brand-400">*</span>
          </label>
          <select
            id="contact-subject"
            name="subject"
            value={values.subject}
            onChange={(event) => setField('subject', event.target.value)}
            aria-invalid={Boolean(errors.subject)}
            aria-describedby={errors.subject ? 'contact-subject-error' : undefined}
            className={`input cursor-pointer ${errors.subject ? 'border-red-500' : ''}`}
          >
            <option value="">Choose a subject…</option>
            {SUBJECTS.map((subject) => (
              <option key={subject} value={subject}>
                {subject}
              </option>
            ))}
          </select>
          {errors.subject ? (
            <p id="contact-subject-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              {errors.subject}
            </p>
          ) : null}
        </div>

        <div className="mt-4">
          <label htmlFor="contact-message" className="label">
            Message <span className="text-brand-600 dark:text-brand-400">*</span>
          </label>
          <textarea
            id="contact-message"
            name="message"
            rows={5}
            value={values.message}
            onChange={(event) => setField('message', event.target.value)}
            aria-invalid={Boolean(errors.message)}
            aria-describedby={errors.message ? 'contact-message-error' : 'contact-message-hint'}
            placeholder="Tell us the service you need, your ZIP code, and anything a provider should know."
            className={`input resize-y ${errors.message ? 'border-red-500' : ''}`}
          />
          {errors.message ? (
            <p id="contact-message-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              {errors.message}
            </p>
          ) : (
            <p id="contact-message-hint" className="mt-1.5 text-xs text-muted">
              Please do not include sensitive information such as Social Security or full payment details.
            </p>
          )}
        </div>

        {/* Honeypot — hidden from people, tempting to bots */}
        <div className="hidden" aria-hidden="true">
          <label htmlFor="contact-company">Company</label>
          <input
            id="contact-company"
            name="company"
            tabIndex={-1}
            autoComplete="off"
            value={values.company}
            onChange={(event) => setField('company', event.target.value)}
          />
        </div>

        <div className="mt-5">
          <label htmlFor="contact-consent" className="flex cursor-pointer items-start gap-3 text-sm leading-6">
            <input
              id="contact-consent"
              name="consent"
              type="checkbox"
              checked={values.consent}
              onChange={(event) => setField('consent', event.target.checked)}
              aria-invalid={Boolean(errors.consent)}
              aria-describedby={errors.consent ? 'contact-consent-error' : undefined}
              className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-line accent-brand-600"
            />
            <span className="text-muted">
              I agree to be contacted about this request by email,
              {' '}and I have read the{' '}
              <Link to="/privacy-policy" className="link">
                Privacy Policy
              </Link>
              . <span className="text-brand-600 dark:text-brand-400">*</span>
            </span>
          </label>
          {errors.consent ? (
            <p id="contact-consent-error" className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">
              {errors.consent}
            </p>
          ) : null}
        </div>

        <button type="submit" disabled={status === 'submitting'} className="btn-primary mt-6 w-full sm:w-auto">
          {status === 'submitting' ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Sending…
            </>
          ) : (
            <>
              <Send className="h-4 w-4" aria-hidden="true" />
              Send message
            </>
          )}
        </button>

        <p className="mt-3 text-xs leading-5 text-muted">
          {CONTACT_FORM_CONNECTED
            ? 'We reply to the address you provide, usually within one business day.'
            : `Sending opens your email app with the message filled in, so it reaches ${SITE.contact.email} from your own address.`}
        </p>
      </form>
    </div>
  )
}
