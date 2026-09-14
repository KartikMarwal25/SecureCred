/**
 * Zod validation schemas shared by the API (server-side enforcement, authoritative)
 * and the web client (same-shape client-side feedback). One schema per endpoint (LLD §5).
 */
import { z } from 'zod';
import { CERTIFICATE_TYPE, CERT_STATE, ROLE, VERIFICATION_METHOD } from './constants.js';

/** Certificate number format: <INSTITUTION_CODE>-<YYYY>-<12-char Crockford Base32>. */
export const certificateNumberSchema = z
  .string()
  .regex(
    /^[A-Z0-9]{3,8}-\d{4}-[0-9A-HJKMNP-TV-Z]{12}$/,
    'This does not look like a SecureCred certificate identifier.',
  );

export const emailSchema = z
  .string()
  .trim()
  .min(1, "This is not a complete email address. It needs a domain, for example name@skit.ac.in.")
  .email("This is not a complete email address. It needs a domain, for example name@skit.ac.in.");

export const issuanceRequestSchema = z.object({
  holderName: z
    .string()
    .trim()
    .min(2, "Enter the holder's name exactly as it should appear on the certificate.")
    .max(120, "Enter the holder's name exactly as it should appear on the certificate."),
  holderEmail: emailSchema,
  enrollmentNumber: z
    .string()
    .trim()
    .min(1, 'Enter the enrolment number exactly as it appears in the student record.')
    .max(64, 'Enter the enrolment number exactly as it appears in the student record.'),
  title: z
    .string()
    .trim()
    .min(1, 'Enter the full title of the credential as it is awarded.')
    .max(200, 'Enter the full title of the credential as it is awarded.'),
  certificateType: z.enum(Object.values(CERTIFICATE_TYPE), {
    errorMap: () => ({ message: 'Choose the type of certificate being issued.' }),
  }),
  course: z
    .string()
    .trim()
    .min(1, 'Choose the programme this credential is awarded under.')
    .max(200),
  gradeOrResult: z.string().trim().max(120).optional(),
  issueDate: z
    .string()
    .refine((value) => !Number.isNaN(Date.parse(value)), 'Enter a valid issue date.')
    .refine(
      (value) => new Date(value).getTime() <= Date.now(),
      'The issue date cannot be in the future. Enter the date the institution is awarding the credential.',
    ),
  attributes: z.record(z.string(), z.unknown()).optional(),
});

export const revocationRequestSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(10, 'Explain why this credential is being revoked (10-160 characters).')
    .max(160, 'Explain why this credential is being revoked (10-160 characters).'),
});

export const certificateListQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
  status: z.enum(Object.values(CERT_STATE)).optional(),
  q: z.string().trim().max(200).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
});

export const verificationMethodSchema = z.enum(Object.values(VERIFICATION_METHOD));

export const certificateIdParamSchema = z.object({
  id: z.string().uuid(),
});

export const joinRequestIdParamSchema = z.object({
  requestId: z.string().uuid(),
});

export const certificateNumberParamSchema = z.object({
  certificateNumber: certificateNumberSchema,
});

/** `<INSTITUTION_CODE>` shape, matching the `institution.institution_code` DB constraint. */
export const institutionCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9]{3,8}$/, 'Use 3-8 letters/numbers, e.g. SKIT.');

/**
 * One-time role choice a brand-new signed-up user submits (see
 * `POST /api/v1/auth/choose-role`). A student needs nothing further; an
 * institution provides its name and a short code — a new institution row is
 * created if that code doesn't exist yet, or the account joins the existing
 * institution with that code if it does.
 */
export const chooseRoleRequestSchema = z.discriminatedUnion('role', [
  z.object({ role: z.literal(ROLE.STUDENT) }),
  z.object({
    role: z.literal(ROLE.INSTITUTION),
    institutionName: z
      .string()
      .trim()
      .min(2, "Enter your institution's full name.")
      .max(200, "Enter your institution's full name."),
    institutionCode: institutionCodeSchema,
    // Required only when joining an institution that already exists (checked
    // at the route layer, since that depends on a DB lookup, not something a
    // static schema can express) — omitted when creating a brand-new one.
    accessCode: z.string().trim().max(64).optional(),
  }),
]);
