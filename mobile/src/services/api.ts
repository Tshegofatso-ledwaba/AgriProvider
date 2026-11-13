import { Platform } from 'react-native';

const DEFAULT_API_BASE_URLS = [
  'http://localhost:5000',
  'http://127.0.0.1:5000',
  'http://10.0.2.2:5000',
  'http://192.168.137.1:5000',
] as const;

function normalizeApiBaseUrl(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.replace(/\/+$/, '');
}

const configuredApiBaseUrl = normalizeApiBaseUrl(process.env.EXPO_PUBLIC_API_URL);
export const apiBaseUrl = configuredApiBaseUrl ?? DEFAULT_API_BASE_URLS[0];
export const hasApiBaseUrl = Boolean(configuredApiBaseUrl || DEFAULT_API_BASE_URLS.length);
export const cookieSessionCredential = 'http-only-cookie-session';

function isPublicRoute(path: string) {
  return path === '/api/auth/login'
    || path === '/api/auth/register'
    || path === '/api/auth/learner-activation'
    || path.startsWith('/api/certificates/verify/');
}

type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | undefined;

export class ApiError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export function setUnauthorizedHandler(handler: UnauthorizedHandler): () => void {
  unauthorizedHandler = handler;
  return () => {
    if (unauthorizedHandler === handler) {
      unauthorizedHandler = undefined;
    }
  };
}

export async function requestApi(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    token?: string;
    authMode?: 'cookie';
    body?: Record<string, unknown>;
  } = {},
): Promise<unknown> {
  const cookieSession = Platform.OS === 'web'
    && (options.authMode === 'cookie' || Boolean(options.token));
  const publicRequest = Platform.OS === 'web' && isPublicRoute(path);
  if (Platform.OS === 'web' && !cookieSession && !publicRequest) {
    throw new ApiError('A secure web session is required for this request. Sign in again.');
  }
  if (Platform.OS !== 'web' && options.authMode === 'cookie') {
    throw new ApiError('Cookie sessions are only available in a web browser.');
  }

  let response: Response;
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (options.body) {
      headers['Content-Type'] = 'application/json';
    }
    if (cookieSession) {
      headers['X-Auth-Mode'] = 'cookie';
    } else if (options.token) {
      headers.Authorization = 'Bearer ' + options.token;
    }

    response = await fetch(`${apiBaseUrl}${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: cookieSession ? 'include' : 'same-origin',
    });
  } catch {
    throw new ApiError('Could not reach the API. Check the server and your network connection.');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    if (response.status === 401 && options.token) {
      await unauthorizedHandler?.();
    }
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The API could not complete the request.';
    const code = isRecord(payload) && typeof payload.code === 'string'
      ? payload.code
      : undefined;
    throw new ApiError(message, response.status, code);
  }

  return payload;
}

export type UploadAsset = {
  uri: string;
  name: string;
  mimeType: string;
};

export async function uploadFile(
  path: string,
  token: string,
  asset: UploadAsset,
  onProgress: (progress: number) => void,
): Promise<unknown> {
  if (Platform.OS === 'web') {
    throw new ApiError('Evidence uploads are available in the iOS and Android apps.');
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('file', {
      uri: asset.uri,
      name: asset.name,
      type: asset.mimeType,
    } as unknown as Blob);

    xhr.open('POST', `${apiBaseUrl}${path}`);
    xhr.setRequestHeader('Accept', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(Math.min(1, event.loaded / event.total));
      }
    };
    xhr.onerror = () => reject(new ApiError('Could not reach the API. Check the server and your network connection.'));
    xhr.ontimeout = () => reject(new ApiError('The upload timed out. Check your connection and retry.'));
    xhr.onload = () => {
      let payload: unknown;
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        payload = null;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'The API could not complete the upload.';
        const code = isRecord(payload) && typeof payload.code === 'string'
          ? payload.code
          : undefined;
        reject(new ApiError(message, xhr.status, code));
        return;
      }
      resolve(payload);
    };
    xhr.send(formData);
  });
}

export async function downloadFile(path: string, token: string): Promise<Uint8Array> {
  if (Platform.OS === 'web') {
    throw new ApiError('Evidence downloads are available in the iOS and Android apps.');
  }

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', `${apiBaseUrl}${path}`);
    xhr.setRequestHeader('Accept', 'application/octet-stream');
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.responseType = 'arraybuffer';
    xhr.onerror = () => reject(new ApiError('Could not reach the API. Check the server and your network connection.'));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        let payload: unknown;
        try {
          payload = JSON.parse(new TextDecoder().decode(xhr.response));
        } catch {
          payload = null;
        }
        const message = isRecord(payload) && typeof payload.error === 'string'
          ? payload.error
          : 'The API could not retrieve this file.';
        reject(new ApiError(message, xhr.status));
        return;
      }
      resolve(new Uint8Array(xhr.response));
    };
    xhr.send();
  });
}

export async function downloadPrivateFile(path: string, token: string): Promise<Uint8Array> {
  if (Platform.OS !== 'web') {
    return downloadFile(path, token);
  }
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      headers: { Accept: 'application/octet-stream', 'X-Auth-Mode': 'cookie' },
      credentials: 'include',
    });
  } catch {
    throw new ApiError('Could not reach the API. Check the server and your network connection.');
  }

  if (!response.ok) {
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }
    if (response.status === 401) await unauthorizedHandler?.();
    const message = isRecord(payload) && typeof payload.error === 'string'
      ? payload.error
      : 'The API could not retrieve this file.';
    throw new ApiError(message, response.status);
  }

  return new Uint8Array(await response.arrayBuffer());
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function apiErrorText(error: unknown) {
  return error instanceof ApiError
    ? error.message
    : 'The request could not be completed. Please try again.';
}
