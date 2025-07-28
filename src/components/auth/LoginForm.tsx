import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Eye, EyeOff, Shield, Stethoscope } from 'lucide-react';
import { authService } from '@/lib/auth';
import { logger } from '@/lib/logger';
import { checkClientRateLimit } from '@/lib/rateLimit';

const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  mfaCode: z.string().optional(),
});

type LoginFormData = z.infer<typeof loginSchema>;

interface LoginFormProps {
  onSuccess: () => void;
  onSwitchToSignup: () => void;
  onForgotPassword: () => void;
}

export function LoginForm({ onSuccess, onSwitchToSignup, onForgotPassword }: LoginFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showMfaInput, setShowMfaInput] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rateLimitError, setRateLimitError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
    watch,
    setValue,
  } = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
  });

  const email = watch('email');
  const password = watch('password');

  const onSubmit = async (data: LoginFormData) => {
    setError(null);
    setRateLimitError(null);

    // Check rate limit
    const rateLimitCheck = await checkClientRateLimit('auth-login');
    if (!rateLimitCheck.allowed) {
      setRateLimitError(rateLimitCheck.message || 'Too many login attempts');
      return;
    }

    setIsLoading(true);

    try {
      const session = await authService.signIn(data.email, data.password, data.mfaCode);
      
      logger.audit('User signed in successfully', {
        user_id: session.user.id,
        email: data.email,
      });

      onSuccess();
    } catch (err: any) {
      logger.security('Login attempt failed', {
        email: data.email,
        error: err.message,
      });

      if (err.message === 'MFA code required') {
        setShowMfaInput(true);
        setError('Please enter your MFA code to continue');
      } else if (err.message.includes('Invalid login credentials')) {
        setError('Invalid email or password. Please check your credentials and try again.');
      } else if (err.message.includes('Too many requests')) {
        setRateLimitError('Too many login attempts. Please wait before trying again.');
      } else if (err.message.includes('Invalid medical credentials')) {
        setError('Your account lacks required medical credentials. Please contact support.');
      } else {
        setError(err.message || 'An error occurred during login. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) {
      setError('Please enter your email address first');
      return;
    }

    // Check rate limit for password reset
    const rateLimitCheck = await checkClientRateLimit('auth-reset');
    if (!rateLimitCheck.allowed) {
      setRateLimitError(rateLimitCheck.message || 'Too many password reset attempts');
      return;
    }

    try {
      await authService.resetPassword(email);
      onForgotPassword();
    } catch (err: any) {
      setError(err.message || 'Failed to send password reset email');
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="space-y-1">
        <div className="flex items-center justify-center mb-4">
          <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded-full">
            <Stethoscope className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
        </div>
        <CardTitle className="text-2xl text-center">Welcome to NelsonGPT</CardTitle>
        <CardDescription className="text-center">
          Sign in to your medical professional account
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Email Input */}
          <div className="space-y-2">
            <Label htmlFor="email">Email Address</Label>
            <Input
              id="email"
              type="email"
              placeholder="doctor@hospital.com"
              {...register('email')}
              className={errors.email ? 'border-red-500' : ''}
              disabled={isLoading}
            />
            {errors.email && (
              <p className="text-sm text-red-500">{errors.email.message}</p>
            )}
          </div>

          {/* Password Input */}
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <div className="relative">
              <Input
                id="password"
                type={showPassword ? 'text' : 'password'}
                placeholder="Enter your password"
                {...register('password')}
                className={errors.password ? 'border-red-500 pr-10' : 'pr-10'}
                disabled={isLoading}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowPassword(!showPassword)}
                disabled={isLoading}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
                <span className="sr-only">
                  {showPassword ? 'Hide password' : 'Show password'}
                </span>
              </Button>
            </div>
            {errors.password && (
              <p className="text-sm text-red-500">{errors.password.message}</p>
            )}
          </div>

          {/* MFA Code Input (shown when required) */}
          {showMfaInput && (
            <div className="space-y-2">
              <Label htmlFor="mfaCode">
                <Shield className="inline h-4 w-4 mr-1" />
                MFA Code
              </Label>
              <Input
                id="mfaCode"
                type="text"
                placeholder="Enter 6-digit code"
                maxLength={6}
                {...register('mfaCode')}
                className={errors.mfaCode ? 'border-red-500' : ''}
                disabled={isLoading}
                autoComplete="one-time-code"
              />
              {errors.mfaCode && (
                <p className="text-sm text-red-500">{errors.mfaCode.message}</p>
              )}
              <p className="text-xs text-muted-foreground">
                Enter the 6-digit code from your authenticator app
              </p>
            </div>
          )}

          {/* Error Alerts */}
          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {rateLimitError && (
            <Alert variant="destructive">
              <AlertDescription>{rateLimitError}</AlertDescription>
            </Alert>
          )}

          {/* Submit Button */}
          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Signing in...
              </>
            ) : (
              'Sign In'
            )}
          </Button>

          {/* Forgot Password Link */}
          <div className="text-center">
            <Button
              type="button"
              variant="link"
              onClick={handleForgotPassword}
              disabled={isLoading}
              className="text-sm"
            >
              Forgot your password?
            </Button>
          </div>

          {/* Sign Up Link */}
          <div className="text-center">
            <p className="text-sm text-muted-foreground">
              Don't have an account?{' '}
              <Button
                type="button"
                variant="link"
                onClick={onSwitchToSignup}
                disabled={isLoading}
                className="p-0 h-auto font-semibold"
              >
                Sign up here
              </Button>
            </p>
          </div>
        </form>

        {/* Security Notice */}
        <div className="mt-6 p-4 bg-muted rounded-lg">
          <div className="flex items-start space-x-2">
            <Shield className="h-4 w-4 text-muted-foreground mt-0.5" />
            <div className="text-xs text-muted-foreground">
              <p className="font-semibold mb-1">Security Notice</p>
              <p>
                This application requires valid medical credentials and HIPAA training.
                All access is logged for audit purposes.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}