import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { authService } from '../auth';
import { supabase } from '../supabase';

// Mock Supabase
vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      signOut: vi.fn(),
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(),
    })),
  },
}));

// Mock logger
vi.mock('../logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    security: vi.fn(),
    audit: vi.fn(),
  },
}));

// Mock CryptoJS
vi.mock('crypto-js', () => ({
  default: {
    AES: {
      encrypt: vi.fn(() => ({ toString: () => 'encrypted-data' })),
      decrypt: vi.fn(() => ({ toString: () => '{"test":"data"}' })),
    },
    SHA256: vi.fn(() => ({ toString: () => 'hashed-key' })),
    enc: {
      Utf8: 'utf8',
    },
  },
}));

describe('AuthService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset localStorage
    Object.defineProperty(window, 'localStorage', {
      value: {
        getItem: vi.fn(),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      },
      writable: true,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('signIn', () => {
    it('should successfully sign in with valid credentials', async () => {
      const mockSession = {
        user: {
          id: 'test-user-id',
          email: 'test@example.com',
          user_metadata: {
            license_number: 'MD123456',
            institution: 'Test Hospital',
            role: 'physician',
            last_hipaa_training: new Date().toISOString(),
          },
        },
        access_token: 'test-token',
      };

      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      (supabase.from as any).mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'role-id',
                name: 'physician',
                permissions: ['read_content', 'calculate_dosage'],
              },
              error: null,
            }),
          }),
        }),
      });

      global.fetch = vi.fn().mockResolvedValue({
        json: () => Promise.resolve({ ip: '127.0.0.1' }),
      });

      const result = await authService.signIn('test@example.com', 'password123');

      expect(result).toBeDefined();
      expect(result.user.id).toBe('test-user-id');
      expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
        email: 'test@example.com',
        password: 'password123',
      });
    });

    it('should handle invalid credentials', async () => {
      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { session: null },
        error: { message: 'Invalid login credentials' },
      });

      await expect(
        authService.signIn('test@example.com', 'wrongpassword')
      ).rejects.toThrow('Invalid login credentials');
    });

    it('should handle MFA requirement', async () => {
      const mockSession = {
        user: {
          id: 'test-user-id',
          user_metadata: {
            mfa_enabled: true,
            license_number: 'MD123456',
            institution: 'Test Hospital',
            role: 'physician',
            last_hipaa_training: new Date().toISOString(),
          },
        },
      };

      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      await expect(
        authService.signIn('test@example.com', 'password123')
      ).rejects.toThrow('MFA code required');
    });

    it('should reject users without valid medical credentials', async () => {
      const mockSession = {
        user: {
          id: 'test-user-id',
          user_metadata: {
            // Missing required medical credentials
            role: 'physician',
          },
        },
      };

      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      await expect(
        authService.signIn('test@example.com', 'password123')
      ).rejects.toThrow('Invalid medical credentials');
    });

    it('should reject users with expired HIPAA training', async () => {
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);

      const mockSession = {
        user: {
          id: 'test-user-id',
          user_metadata: {
            license_number: 'MD123456',
            institution: 'Test Hospital',
            role: 'physician',
            last_hipaa_training: twoYearsAgo.toISOString(),
          },
        },
      };

      (supabase.auth.signInWithPassword as any).mockResolvedValue({
        data: { session: mockSession },
        error: null,
      });

      await expect(
        authService.signIn('test@example.com', 'password123')
      ).rejects.toThrow('Invalid medical credentials');
    });
  });

  describe('signUp', () => {
    it('should successfully create a new user account', async () => {
      (supabase.auth.signUp as any).mockResolvedValue({
        data: { user: { id: 'new-user-id' } },
        error: null,
      });

      const userData = {
        email: 'newuser@example.com',
        password: 'securepassword123',
        full_name: 'Dr. Test User',
        license_number: 'MD789012',
        institution: 'Test Medical Center',
        department: 'Pediatrics',
        role: 'physician',
      };

      await expect(authService.signUp(userData)).resolves.not.toThrow();

      expect(supabase.auth.signUp).toHaveBeenCalledWith({
        email: userData.email,
        password: userData.password,
        options: {
          data: {
            full_name: userData.full_name,
            license_number: userData.license_number,
            institution: userData.institution,
            department: userData.department,
            role: userData.role,
            mfa_enabled: false,
          },
        },
      });
    });

    it('should handle signup errors', async () => {
      (supabase.auth.signUp as any).mockResolvedValue({
        data: { user: null },
        error: { message: 'Email already registered' },
      });

      const userData = {
        email: 'existing@example.com',
        password: 'password123',
        full_name: 'Dr. Test User',
        license_number: 'MD123456',
        institution: 'Test Hospital',
        department: 'Pediatrics',
        role: 'physician',
      };

      await expect(authService.signUp(userData)).rejects.toThrow('Email already registered');
    });
  });

  describe('signOut', () => {
    it('should successfully sign out', async () => {
      (supabase.auth.signOut as any).mockResolvedValue({ error: null });

      await expect(authService.signOut()).resolves.not.toThrow();
      expect(supabase.auth.signOut).toHaveBeenCalled();
      expect(localStorage.removeItem).toHaveBeenCalled();
    });

    it('should handle signout errors gracefully', async () => {
      (supabase.auth.signOut as any).mockResolvedValue({
        error: { message: 'Network error' },
      });

      await expect(authService.signOut()).resolves.not.toThrow();
      expect(localStorage.removeItem).toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should send password reset email', async () => {
      (supabase.auth.resetPasswordForEmail as any).mockResolvedValue({
        error: null,
      });

      await expect(
        authService.resetPassword('test@example.com')
      ).resolves.not.toThrow();

      expect(supabase.auth.resetPasswordForEmail).toHaveBeenCalledWith(
        'test@example.com'
      );
    });

    it('should handle reset password errors', async () => {
      (supabase.auth.resetPasswordForEmail as any).mockResolvedValue({
        error: { message: 'User not found' },
      });

      await expect(
        authService.resetPassword('nonexistent@example.com')
      ).rejects.toThrow('User not found');
    });
  });

  describe('updatePassword', () => {
    it('should update user password', async () => {
      (supabase.auth.updateUser as any).mockResolvedValue({
        error: null,
      });

      await expect(
        authService.updatePassword('newpassword123')
      ).resolves.not.toThrow();

      expect(supabase.auth.updateUser).toHaveBeenCalledWith({
        password: 'newpassword123',
      });
    });

    it('should handle update password errors', async () => {
      (supabase.auth.updateUser as any).mockResolvedValue({
        error: { message: 'Password too weak' },
      });

      await expect(
        authService.updatePassword('weak')
      ).rejects.toThrow('Password too weak');
    });
  });

  describe('hasPermission', () => {
    it('should check user permissions correctly', () => {
      // Mock current session
      const mockSession = {
        user: { id: 'test-user' },
        role: {
          permissions: ['read_content', 'calculate_dosage'],
        },
      };

      // @ts-ignore - accessing private property for testing
      authService.currentSession = mockSession;

      expect(authService.hasPermission('read_content')).toBe(true);
      expect(authService.hasPermission('admin_access')).toBe(false);
    });

    it('should return false when no session', () => {
      // @ts-ignore - accessing private property for testing
      authService.currentSession = null;

      expect(authService.hasPermission('read_content')).toBe(false);
    });
  });

  describe('isAuthenticated', () => {
    it('should return true when authenticated', () => {
      // @ts-ignore - accessing private property for testing
      authService.currentSession = { user: { id: 'test-user' } };

      expect(authService.isAuthenticated()).toBe(true);
    });

    it('should return false when not authenticated', () => {
      // @ts-ignore - accessing private property for testing
      authService.currentSession = null;

      expect(authService.isAuthenticated()).toBe(false);
    });
  });
});