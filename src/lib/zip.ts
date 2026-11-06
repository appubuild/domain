/**
 * US ZIP code validation + normalization.
 * Five digits only, with a sanity range check so obvious junk (00000, 00012)
 * is rejected before we ever look at coverage data.
 */

export const ZIP_LENGTH = 5

/** Strips everything but digits and caps the length at 5. */
export const normalizeZip = (value: string): string =>
  value.replace(/\D/g, '').slice(0, ZIP_LENGTH)

export type ZipValidation = { valid: boolean; message?: string }

export const validateZip = (raw: string): ZipValidation => {
  const zip = normalizeZip(raw)

  if (!zip) return { valid: false, message: 'Enter your 5-digit ZIP code.' }
  if (zip.length < ZIP_LENGTH)
    return { valid: false, message: 'ZIP codes are 5 digits. Keep typing.' }

  const numeric = Number(zip)
  // Real US ZIP codes run from 00501 (Holtsville, NY) to 99950 (Ketchikan, AK).
  if (numeric < 501 || numeric > 99950)
    return { valid: false, message: 'That does not look like a valid US ZIP code.' }

  return { valid: true }
}

export const isValidZip = (raw: string): boolean => validateZip(raw).valid
