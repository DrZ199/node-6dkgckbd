import { supabase } from './supabase';
import { User, Session } from '@supabase/supabase-js';
import { logger } from './logger';
import CryptoJS from 'crypto-js';

export interface UserRole {
  id: string;
  name: 'physician' | 'nurse' | 'resident' | 'student' | 'admin';
  permissions: string[];
}

export interface MedicalUser extends User {
  user_metadata: {
    full_name?: string;
    license_number?: string;
    institution?: string;
    department?: string;
    role?: string;
    last_hipaa_training?: string;
    mfa_enabled?: boolean;
  };
}

export interface AuthSession {
  user: MedicalUser;
  session: Session;
  role: UserRole;
  last_activity: Date;
  ip_address?: string;
  user_agent?: string;
}

class AuthService {
  private currentSession: AuthSession | null = null;
  private sessionTimeout = 30 * 60 * 1000; // 30 minutes
  private maxInactivity = 15 * 60 * 1000; // 15 minutes
  private sessionKey = 'nelsongpt-session';

  constructor() {
    this.initializeSession();
    this.setupSessionMonitoring();
  }

  // Initialize session from localStorage with security checks
  private async initializeSession() {
    try {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error) {
        logger.error('Session initialization error:', error);
        this.clearSession();
        return;
      }

      if (session) {
        await this.validateAndSetSession(session);
      }
    } catch (error) {
      logger.error('Auth initialization failed:', error);
      this.clearSession();
    }
  }

  // Setup session monitoring for auto-logout
  private setupSessionMonitoring() {
    // Monitor user activity
    const events = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart'];
    
    events.forEach(event => {
      document.addEventListener(event, this.updateLastActivity.bind(this), true);
    });

    // Check session validity every minute
    setInterval(() => {
      this.checkSessionValidity();
    }, 60000);

    // Setup auth state change listener
    supabase.auth.onAuthStateChange(async (event, session) => {
      logger.info('Auth state changed:', event);
      
      if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
        if (session) {
          await this.validateAndSetSession(session);
        } else {
          this.clearSession();
        }
      }
    });
  }

  // Validate session and set current session
  private async validateAndSetSession(session: Session) {
    try {
      const user = session.user as MedicalUser;
      
      // Validate user has required medical credentials
      if (!this.validateMedicalCredentials(user)) {
        await this.signOut();
        throw new Error('Invalid medical credentials');
      }

      // Get user role
      const role = await this.getUserRole(user.id);
      
      // Create session object
      this.currentSession = {
        user,
        session,
        role,
        last_activity: new Date(),
        ip_address: await this.getClientIP(),
        user_agent: navigator.userAgent,
      };

      // Log session creation for audit
      await this.logSecurityEvent('session_created', {
        user_id: user.id,
        ip_address: this.currentSession.ip_address,
        user_agent: this.currentSession.user_agent,
      });

      // Store encrypted session data
      this.storeSecureSession();
      
    } catch (error) {
      logger.error('Session validation failed:', error);
      this.clearSession();
    }
  }

  // Validate medical credentials
  private validateMedicalCredentials(user: MedicalUser): boolean {
    const metadata = user.user_metadata;
    
    // Check required fields
    if (!metadata.license_number || !metadata.institution || !metadata.role) {
      return false;
    }

    // Check HIPAA training (must be within last year)
    if (metadata.last_hipaa_training) {
      const trainingDate = new Date(metadata.last_hipaa_training);
      const oneYearAgo = new Date();
      oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
      
      if (trainingDate < oneYearAgo) {
        return false;
      }
    } else {
      return false;
    }

    return true;
  }

  // Get user role and permissions
  private async getUserRole(userId: string): Promise<UserRole> {
    try {
      const { data, error } = await supabase
        .from('user_roles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error || !data) {
        // Default role for new users
        return {
          id: 'default',
          name: 'student',
          permissions: ['read_basic_content'],
        };
      }

      return data;
    } catch (error) {
      logger.error('Failed to get user role:', error);
      return {
        id: 'default',
        name: 'student',
        permissions: ['read_basic_content'],
      };
    }
  }

  // Sign in with email and password
  async signIn(email: string, password: string, mfaCode?: string): Promise<AuthSession> {
    try {
      logger.info('Sign in attempt:', { email });

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        await this.logSecurityEvent('sign_in_failed', {
          email,
          error: error.message,
          ip_address: await this.getClientIP(),
        });
        throw error;
      }

      if (!data.session) {
        throw new Error('No session returned from sign in');
      }

      // Handle MFA if required
      if (data.user?.user_metadata?.mfa_enabled && !mfaCode) {
        throw new Error('MFA code required');
      }

      await this.validateAndSetSession(data.session);
      
      if (!this.currentSession) {
        throw new Error('Failed to create session');
      }

      await this.logSecurityEvent('sign_in_success', {
        user_id: data.user.id,
        ip_address: this.currentSession.ip_address,
      });

      return this.currentSession;
    } catch (error) {
      logger.error('Sign in failed:', error);
      throw error;
    }
  }

  // Sign up new user
  async signUp(userData: {
    email: string;
    password: string;
    full_name: string;
    license_number: string;
    institution: string;
    department: string;
    role: string;
  }): Promise<void> {
    try {
      logger.info('Sign up attempt:', { email: userData.email });

      const { data, error } = await supabase.auth.signUp({
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

      if (error) {
        await this.logSecurityEvent('sign_up_failed', {
          email: userData.email,
          error: error.message,
        });
        throw error;
      }

      await this.logSecurityEvent('sign_up_success', {
        user_id: data.user?.id,
        email: userData.email,
      });

    } catch (error) {
      logger.error('Sign up failed:', error);
      throw error;
    }
  }

  // Sign out
  async signOut(): Promise<void> {
    try {
      if (this.currentSession) {
        await this.logSecurityEvent('sign_out', {
          user_id: this.currentSession.user.id,
        });
      }

      await supabase.auth.signOut();
      this.clearSession();
    } catch (error) {
      logger.error('Sign out failed:', error);
      this.clearSession();
    }
  }

  // Update last activity timestamp
  private updateLastActivity() {
    if (this.currentSession) {
      this.currentSession.last_activity = new Date();
      this.storeSecureSession();
    }
  }

  // Check session validity
  private checkSessionValidity() {
    if (!this.currentSession) return;

    const now = new Date();
    const lastActivity = this.currentSession.last_activity;
    const timeSinceActivity = now.getTime() - lastActivity.getTime();

    // Auto-logout after inactivity
    if (timeSinceActivity > this.maxInactivity) {
      logger.warn('Session expired due to inactivity');
      this.signOut();
    }
  }

  // Store encrypted session data
  private storeSecureSession() {
    if (!this.currentSession) return;

    try {
      const sessionData = {
        user_id: this.currentSession.user.id,
        last_activity: this.currentSession.last_activity.toISOString(),
        role: this.currentSession.role,
      };

      const encrypted = CryptoJS.AES.encrypt(
        JSON.stringify(sessionData),
        process.env.VITE_SESSION_SECRET || 'default-secret'
      ).toString();

      localStorage.setItem(this.sessionKey, encrypted);
    } catch (error) {
      logger.error('Failed to store session:', error);
    }
  }

  // Clear session data
  private clearSession() {
    this.currentSession = null;
    localStorage.removeItem(this.sessionKey);
  }

  // Get client IP address
  private async getClientIP(): Promise<string> {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch {
      return 'unknown';
    }
  }

  // Log security events for audit trail
  private async logSecurityEvent(event: string, data: any) {
    try {
      await supabase.from('security_audit_log').insert({
        event_type: event,
        event_data: data,
        timestamp: new Date().toISOString(),
        ip_address: data.ip_address || await this.getClientIP(),
        user_agent: navigator.userAgent,
      });
    } catch (error) {
      logger.error('Failed to log security event:', error);
    }
  }

  // Check if user has permission
  hasPermission(permission: string): boolean {
    return this.currentSession?.role.permissions.includes(permission) || false;
  }

  // Get current session
  getCurrentSession(): AuthSession | null {
    return this.currentSession;
  }

  // Get current user
  getCurrentUser(): MedicalUser | null {
    return this.currentSession?.user || null;
  }

  // Check if user is authenticated
  isAuthenticated(): boolean {
    return !!this.currentSession;
  }

  // Reset password
  async resetPassword(email: string): Promise<void> {
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email);
      
      if (error) {
        await this.logSecurityEvent('password_reset_failed', {
          email,
          error: error.message,
        });
        throw error;
      }

      await this.logSecurityEvent('password_reset_requested', { email });
    } catch (error) {
      logger.error('Password reset failed:', error);
      throw error;
    }
  }

  // Update password
  async updatePassword(newPassword: string): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) {
        throw error;
      }

      if (this.currentSession) {
        await this.logSecurityEvent('password_updated', {
          user_id: this.currentSession.user.id,
        });
      }
    } catch (error) {
      logger.error('Password update failed:', error);
      throw error;
    }
  }
}

export const authService = new AuthService();
export default authService;