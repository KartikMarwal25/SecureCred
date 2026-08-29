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
  constructor(message, { status, code, details } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status ?? null;
    this.code = code ?? null;
    this.details = details ?? null;
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
    });
  }

  return data;
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

export function getCertificateDocumentUrl(certificateNumber) {
  return `${BASE_URL}/certificates/${encodeURIComponent(certificateNumber)}/document`;
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

// ---- Student ----------------------------------------------------------------

export async function listMyCredentials() {
  return request('/students/me/certificates', { method: 'GET' });
}
