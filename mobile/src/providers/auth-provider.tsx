import * as SecureStore from 'expo-secure-store';
import {
  createContext,
  PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { Platform } from 'react-native';

import {
  ApiError,
  cookieSessionCredential,
  isRecord,
  requestApi,
  setUnauthorizedHandler,
} from '@/services/api';

const sessionKey = 'agriprovider.access-token';

export type UserRole = 'provider' | 'assessor' | 'qa' | 'admin';

export type AuthUser = {
  id: string;
  fullName: string;
  email: string;
  role: UserRole;
};

type AuthResult = {
  user: AuthUser;
  accessToken?: string;
};

type AuthContextValue = {
  user: AuthUser | null;
  credential: string | null;
  isLoading: boolean;
  isBusy: boolean;
  sessionError: string;
  signIn: (email: string, password: string, accountType: UserRole) => Promise<void>;
  register: (fullName: string, email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearSessionError: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function isUser(value: unknown): value is AuthUser {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.fullName === 'string'
    && typeof value.email === 'string'
    && (value.role === 'provider' || value.role === 'assessor' || value.role === 'qa' || value.role === 'admin');
}

function isAuthResult(value: unknown): value is AuthResult {
  return isRecord(value) && isUser(value.user)
    && (value.accessToken === undefined || typeof value.accessToken === 'string');
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [credential, setCredential] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [sessionError, setSessionError] = useState('');

  useEffect(() => setUnauthorizedHandler(async () => {
    if (!user || !credential) return;
    setSessionError('Your session expired. Please sign in again.');
    setUser(null);
    setCredential(null);
    if (Platform.OS !== 'web') {
      try {
        await SecureStore.deleteItemAsync(sessionKey);
      } catch {
        setSessionError('Your session expired. Close and reopen the app, then sign in again.');
      }
    }
  }), [credential, user]);

  useEffect(() => {
    let active = true;

    const restoreSession = async () => {
      try {
        const isWeb = Platform.OS === 'web';
        const token = isWeb ? null : await SecureStore.getItemAsync(sessionKey);
        if (!isWeb && !token) {
          return;
        }

        try {
          const payload = await requestApi('/api/auth/me', {
            token: token ?? undefined,
            authMode: isWeb ? 'cookie' : undefined,
          });
          if (!isRecord(payload) || !isUser(payload.user)) {
            throw new ApiError('The API returned an unexpected profile response.');
          }
          if (active) {
            setCredential(token ?? cookieSessionCredential);
            setUser(payload.user);
          }
        } catch (error) {
          if (error instanceof ApiError && error.status === 401) {
            if (!isWeb) {
              await SecureStore.deleteItemAsync(sessionKey);
            }
            if (active && !isWeb) {
              setSessionError('Your session expired. Please sign in again.');
            }
          } else {
            throw error;
          }
        }
      } catch {
        if (active) {
          setSessionError('Could not restore your secure session. Check your connection and sign in again.');
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    };

    void restoreSession();
    return () => {
      active = false;
    };
  }, []);

  const authenticate = useCallback(async (
    endpoint: 'login' | 'register',
    body: Record<string, unknown>,
  ) => {
    setIsBusy(true);
    setSessionError('');
    try {
      const isWeb = Platform.OS === 'web';
      const payload = await requestApi(`/api/auth/${endpoint}`, {
        body,
        authMode: isWeb ? 'cookie' : undefined,
      });
      if (!isAuthResult(payload)) {
        throw new ApiError('The API returned an unexpected authentication response.');
      }
      if (isWeb) {
        setCredential(cookieSessionCredential);
      } else {
        if (!payload.accessToken) {
          throw new ApiError('The API returned an unexpected authentication response.');
        }
        try {
          await SecureStore.setItemAsync(sessionKey, payload.accessToken);
        } catch {
          throw new ApiError('Sign-in succeeded, but the secure session could not be saved on this device. Try again.');
        }
        setCredential(payload.accessToken);
      }
      setUser(payload.user);
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signIn = useCallback(async (email: string, password: string, accountType: UserRole) => {
    await authenticate('login', { email, password, accountType });
  }, [authenticate]);

  const register = useCallback(async (fullName: string, email: string, password: string) => {
    await authenticate('register', { fullName, email, password, accountType: 'provider' });
  }, [authenticate]);

  const signOut = useCallback(async () => {
    setIsBusy(true);
    setSessionError('');
    try {
      if (Platform.OS === 'web') {
        await requestApi('/api/auth/logout', { method: 'POST', authMode: 'cookie' });
      } else {
        await SecureStore.deleteItemAsync(sessionKey);
      }
      setCredential(null);
      setUser(null);
    } catch {
      throw new ApiError('Could not clear the secure session. Please try again.');
    } finally {
      setIsBusy(false);
    }
  }, []);

  const clearSessionError = useCallback(() => setSessionError(''), []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    credential,
    isLoading,
    isBusy,
    sessionError,
    signIn,
    register,
    signOut,
    clearSessionError,
  }), [user, credential, isLoading, isBusy, sessionError, signIn, register, signOut, clearSessionError]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider.');
  }
  return context;
}
