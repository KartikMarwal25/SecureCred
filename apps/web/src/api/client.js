/**
 * The one and only place this app calls `fetch`. Every component that needs
 * data goes through a helper exported here — this is what keeps 401 handling
 * and the verify-endpoint outcome-vs-status-code switch consistent everywhere.
 */

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000/api/v1').replace(
  /\/+$/,
  '',
);

/** Thrown for every non-2xx response except the verify endpoint (see verifyCertificate). */
export class ApiError extends Error {
  constructor(message, { status, code, details, meta } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? null;
    this.code = code ?? null;
    this.details = details ?? null;
    // Wire-safe structured data the server explicitly chose to attach (e.g.
    // `{certificateId}` on a "created but still retrying" outcome) — never
    // guessed at, only ever what the API's `meta` field actually sent.
    this.meta = meta ?? null;
  }
}

let tokenProvider = async () => null;

/** Wired up once, near the app root, to whatever auth mode (Clerk or dev) is active. */
export function setAuthTokenProvider(fn) {
  tokenProvider = fn || (async () => null);
}

function buildQuery(params) {
  if (!params) return '';
  const usp = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') usp.set(key, String(value));
  });
  const qs = usp.toString();
  return qs ? `?${qs}` : '';
}

async function parseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

async function request(path, { method = 'GET', body, params, auth = true, signal } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const token = await tokenProvider();
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${BASE_URL}${path}${buildQuery(params)}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch {
    throw new ApiError('The server could not be reached. Check your connection and try again.', {
      status: 0,
      code: 'E_NETWORK',
    });
  }

  const data = await parseBody(response);

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      'Something went wrong on the server. Please try again.';
    throw new ApiError(message, {
      status: response.status,
      code: data?.error?.code || data?.code,
      details: data?.error?.details,
      meta: data?.meta,
    });
  }

  return data;
}

// ---- Auth: who am I -----------------------------------------------------------

/**
 * Asks the API who the signed-in Clerk user is (role/institutionId/
 * studentId), since those are resolved authoritatively from the database,
 * not from Clerk's own session-token claims — a self-registered student has
 * no Clerk public metadata at all. See ClerkAuthBridge.jsx.
 */
export async function getMyScope() {
  return request('/auth/me', { method: 'GET' });
}

/**
 * Submits the one-time role choice a brand-new signed-up account makes.
 * `payload` is `{role: 'student'}` or `{role: 'institution', institutionName, institutionCode}`.
 */
export async function chooseRole(payload) {
  return request('/auth/choose-role', { method: 'POST', body: payload });
}

// ---- Institution: certificates -------------------------------------------------

export async function issueCertificate(payload) {
  return request('/certificates', { method: 'POST', body: payload });
}

export async function listCertificates(params) {
  return request('/certificates', { method: 'GET', params });
}

export async function getCertificate(id) {
  return request(`/certificates/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function getCertificateStatus(id) {
  return request(`/certificates/${encodeURIComponent(id)}/status`, { method: 'GET' });
}

export async function revokeCertificate(certificateNumber, reason) {
  return request(`/certificates/revoke/${encodeURIComponent(certificateNumber)}`, {
    method: 'POST',
    body: { reason },
  });
}

/**
 * Submits a CSV of rows to issue as one batch. Resolves as soon as the job
 * is created (status PENDING) — issuance itself runs server-side, one row
 * at a time; poll getBatchStatus(batchJobId) for progress and per-row results.
 */
export async function issueCertificatesBatch(csvContent) {
  return request('/certificates/batch', { method: 'POST', body: { csvContent } });
}

/** Progress and per-row outcomes for a batch issuance job. */
export async function getBatchStatus(batchJobId) {
  return request(`/certificates/batch/${encodeURIComponent(batchJobId)}`, { method: 'GET' });
}

// ---- Public verification ---------------------------------------------------

/**
 * The verify endpoint always describes exactly one outcome
 * (VERIFIED | REVOKED | TAMPERED | NOT_FOUND) in its JSON body, regardless of
 * which HTTP status it used to carry that body (TAMPERED rides on 400,
 * NOT_FOUND on 404 — neither is a client error here). So this function
 * never throws ApiError for those cases; it always resolves with the body
 * and callers switch on `outcome`. It only throws for genuine transport
 * failure or a response with no parseable outcome at all.
 */
export async function verifyCertificate(certificateNumber, { signal } = {}) {
  let response;
  try {
    response = await fetch(
      `${BASE_URL}/certificates/verify/${encodeURIComponent(certificateNumber)}`,
      { method: 'GET', headers: { Accept: 'application/json' }, signal },
    );
  } catch {
    throw new ApiError('The server could not be reached. Check your connection and try again.', {
      status: 0,
      code: 'E_NETWORK',
    });
  }

  const data = await parseBody(response);
  if (!data || !data.outcome) {
    throw new ApiError('The verification service returned an unexpected response.', {
      status: response.status,
    });
  }
  return data;
}

/**
 * Same outcome contract as verifyCertificate (never throws ApiError for
 * TAMPERED/NOT_FOUND — only for a genuine transport failure or an
 * unparseable response), but checks the verifier's OWN uploaded file
 * against the certificate's stored fingerprint directly, rather than
 * re-fetching the document from IPFS. This is the only check that can
 * actually catch a document the verifier altered themselves — see the
 * comment above the equivalent endpoint on the API side for why.
 *
 * @param {string} certificateNumber
 * @param {File|Blob} file
 */
export async function verifyCertificateWithUpload(certificateNumber, file) {
  let response;
  try {
    response = await fetch(
      `${BASE_URL}/certificates/verify-upload/${encodeURIComponent(certificateNumber)}`,
      {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/pdf' },
        body: file,
      },
    );
  } catch {
    throw new ApiError('The server could not be reached. Check your connection and try again.', {
      status: 0,
      code: 'E_NETWORK',
    });
  }

  const data = await parseBody(response);
  if (!data || !data.outcome) {
    throw new ApiError('The verification service returned an unexpected response.', {
      status: response.status,
    });
  }
  return data;
}

export function getCertificateDocumentUrl(certificateNumber) {
  return `${BASE_URL}/certificates/${encodeURIComponent(certificateNumber)}/document`;
}

/**
 * Fetches the certificate PDF as a Blob, going through the same ApiError
 * shape as every other endpoint — used instead of a plain `<a href>` so the
 * caller can show a loading state and a real error message instead of the
 * browser navigating to a raw JSON error response.
 *
 * @param {string} certificateNumber
 * @returns {Promise<Blob>}
 * @throws {ApiError}
 */
export async function fetchCertificateDocument(certificateNumber) {
  let response;
  try {
    response = await fetch(getCertificateDocumentUrl(certificateNumber));
  } catch {
    throw new ApiError('The server could not be reached. Check your connection and try again.', {
      status: 0,
      code: 'E_NETWORK',
    });
  }

  if (!response.ok) {
    const data = await parseBody(response);
    const message =
      data?.error?.message ||
      data?.message ||
      'The certificate document is unavailable right now.';
    throw new ApiError(message, {
      status: response.status,
      code: data?.error?.code || data?.code,
      details: data?.error?.details,
    });
  }

  return response.blob();
}

// ---- Institution: activity ---------------------------------------------------

/**
 * NOTE: the documented API contract (the 8 endpoints this client is built
 * against) does not include an analytics/activity endpoint — there is no
 * specified shape for verification counts, most-verified certificates, or
 * outcome distribution. This calls a best-guess path so ActivityPage has a
 * real integration point ready; until that endpoint exists server-side this
 * will 404 and the page shows a clear "not available" state instead of
 * fabricating numbers.
 */
export async function getActivityStats() {
  return request('/institutions/me/activity', { method: 'GET' });
}

/**
 * Public, unauthenticated — the real registered issuer with the most active
 * certificates, for the landing page's showcase card. Returns
 * `{institutionName: null, certificateCount: 0}` if no institution has
 * registered yet, rather than 404ing.
 */
export async function getInstitutionShowcase() {
  return request('/institutions/showcase', { method: 'GET', auth: false });
}

/** The signed-in staff member's own institution — name and public code. */
export async function getMyInstitution() {
  return request('/institutions/me', { method: 'GET' });
}

/**
 * The custodian wallet's current gas balance — the shared wallet that
 * broadcasts every institution's anchor/revoke transactions. Returns
 * `{gasStatus: 'healthy'|'low'|'critical', balance: string, currency: 'POL'}`.
 * A low/critical balance means issuance or revocation could start failing
 * for lack of gas, independent of anything the institution itself did.
 */
export async function getGasStatus() {
  return request('/institutions/me/gas-status', { method: 'GET' });
}

/**
 * Generates a new access code for the signed-in staff member's institution
 * and immediately invalidates the old one. Any staff member may call this —
 * there is no separate admin tier — so the new code must be shared with
 * colleagues right away.
 */
export async function rotateInstitutionAccessCode() {
  return request('/institutions/me/rotate-access-code', { method: 'POST' });
}

/**
 * Detaches the signed-in staff member from their institution — self-service
 * fix for having created or joined the wrong one (e.g. a typo'd institution
 * code). Their account and any certificates they've already issued/revoked
 * are untouched; they just go back through /choose-role to pick correctly.
 */
export async function leaveInstitution() {
  return request('/institutions/me/leave', { method: 'POST' });
}

/** Pending requests to join the signed-in staff member's institution. */
export async function listJoinRequests() {
  return request('/institutions/me/join-requests', { method: 'GET' });
}

/** Grants the requester real institution access. */
export async function approveJoinRequest(requestId) {
  return request(`/institutions/me/join-requests/${encodeURIComponent(requestId)}/approve`, { method: 'POST' });
}

/** Declines the request; the requester may submit a new one later. */
export async function rejectJoinRequest(requestId) {
  return request(`/institutions/me/join-requests/${encodeURIComponent(requestId)}/reject`, { method: 'POST' });
}

// ---- Student ----------------------------------------------------------------

export async function listMyCredentials() {
  return request('/students/me/certificates', { method: 'GET' });
}
