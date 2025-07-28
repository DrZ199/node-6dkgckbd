import React from 'react';
import { ErrorBoundary as ReactErrorBoundary } from 'react-error-boundary';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Alert, AlertDescription } from './ui/alert';
import { AlertTriangle, RefreshCw, Home, Bug } from 'lucide-react';
import { logError, logger } from '@/lib/logger';
import { authService } from '@/lib/auth';

interface ErrorFallbackProps {
  error: Error;
  resetErrorBoundary: () => void;
}

function ErrorFallback({ error, resetErrorBoundary }: ErrorFallbackProps) {
  const user = authService.getCurrentUser();
  const isProduction = process.env.NODE_ENV === 'production';

  const handleReportError = () => {
    // In a real application, this would send the error to a reporting service
    logger.error('User reported error manually', {
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      user_id: user?.id,
      timestamp: new Date().toISOString(),
    });

    // Show confirmation to user
    alert('Error report sent. Thank you for helping us improve NelsonGPT.');
  };

  const handleGoHome = () => {
    // Clear any corrupted state and redirect to home
    window.location.href = '/';
  };

  // Sanitize error message for display (remove any sensitive information)
  const getSafeErrorMessage = (error: Error): string => {
    const message = error.message;
    
    // Remove any potential sensitive data patterns
    const sanitized = message
      .replace(/\b\d{3}-\d{2}-\d{4}\b/g, '[SSN]') // SSN patterns
      .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]') // Email patterns
      .replace(/\b\d{10,}\b/g, '[NUMBER]') // Long numbers (could be medical record numbers)
      .replace(/Bearer\s+[\w\-\.=]+/g, '[TOKEN]'); // Auth tokens

    return sanitized;
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-red-100 dark:bg-red-900 p-3 rounded-full">
              <AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-400" />
            </div>
          </div>
          <CardTitle className="text-2xl">Something went wrong</CardTitle>
          <CardDescription>
            We encountered an unexpected error. Our team has been notified.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Error Information */}
          {!isProduction && (
            <Alert variant="destructive">
              <Bug className="h-4 w-4" />
              <AlertDescription className="font-mono text-sm">
                <strong>Error:</strong> {error.name}<br />
                <strong>Message:</strong> {getSafeErrorMessage(error)}
              </AlertDescription>
            </Alert>
          )}

          {isProduction && (
            <Alert>
              <AlertDescription>
                An unexpected error occurred while processing your request. 
                Please try refreshing the page or contact support if the problem persists.
              </AlertDescription>
            </Alert>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col space-y-2">
            <Button onClick={resetErrorBoundary} className="w-full">
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            
            <Button variant="outline" onClick={handleGoHome} className="w-full">
              <Home className="mr-2 h-4 w-4" />
              Go to Home
            </Button>
            
            <Button variant="outline" onClick={handleReportError} className="w-full">
              <Bug className="mr-2 h-4 w-4" />
              Report This Error
            </Button>
          </div>

          {/* Support Information */}
          <div className="text-center text-sm text-muted-foreground">
            <p>
              If you continue to experience issues, please contact support with 
              error code: <code className="bg-muted px-1 rounded">{Date.now()}</code>
            </p>
          </div>

          {/* Medical Disclaimer */}
          <Alert className="mt-4">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription className="text-xs">
              <strong>Medical Safety Notice:</strong> If you were in the middle of a critical 
              medical decision, please consult appropriate medical resources or colleagues. 
              Do not rely solely on this application for emergency medical situations.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<ErrorFallbackProps>;
  onError?: (error: Error, errorInfo: any) => void;
}

export function ErrorBoundary({ 
  children, 
  fallback = ErrorFallback,
  onError 
}: ErrorBoundaryProps) {
  const handleError = (error: Error, errorInfo: any) => {
    // Log error with HIPAA-compliant information
    logError(error, errorInfo);
    
    // Call custom error handler if provided
    if (onError) {
      onError(error, errorInfo);
    }

    // In production, you might want to send this to an error reporting service
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to Sentry, LogRocket, or custom service
      // Make sure to sanitize any sensitive data before sending
    }
  };

  return (
    <ReactErrorBoundary
      FallbackComponent={fallback}
      onError={handleError}
      onReset={() => {
        // Clear any corrupted state
        localStorage.removeItem('nelsongpt-session');
        logger.info('Error boundary reset - cleared session storage');
      }}
    >
      {children}
    </ReactErrorBoundary>
  );
}

// Async error boundary for handling promise rejections
export function setupGlobalErrorHandlers() {
  // Handle unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    logger.error('Unhandled promise rejection', {
      reason: event.reason,
      promise: event.promise,
      url: window.location.href,
    });

    // Prevent the default browser behavior (logging to console)
    event.preventDefault();

    // Show user-friendly error message
    if (event.reason instanceof Error) {
      // You could show a toast notification here
      console.error('An unexpected error occurred:', event.reason.message);
    }
  });

  // Handle global errors
  window.addEventListener('error', (event) => {
    logger.error('Global error caught', {
      message: event.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      error: event.error,
      url: window.location.href,
    });
  });

  // Handle resource loading errors
  window.addEventListener('error', (event) => {
    if (event.target && event.target !== window) {
      const target = event.target as HTMLElement;
      
      if (target.tagName === 'IMG' || target.tagName === 'SCRIPT' || target.tagName === 'LINK') {
        logger.warn('Resource loading failed', {
          tagName: target.tagName,
          src: (target as any).src || (target as any).href,
          url: window.location.href,
        });
      }
    }
  }, true);
}

// Medical-specific error types
export class MedicalDataError extends Error {
  constructor(message: string, public readonly category: 'dosage' | 'protocol' | 'content' | 'calculation') {
    super(message);
    this.name = 'MedicalDataError';
  }
}

export class SecurityError extends Error {
  constructor(message: string, public readonly securityCode: string) {
    super(message);
    this.name = 'SecurityError';
  }
}

export class RateLimitError extends Error {
  constructor(message: string, public readonly resetTime: Date) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// Error reporting utilities
export const errorReporting = {
  // Report API errors
  reportApiError: (endpoint: string, error: Error, requestData?: any) => {
    logger.error('API Error', {
      endpoint,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
      },
      requestData: requestData ? '[SANITIZED]' : undefined,
    });
  },

  // Report medical calculation errors
  reportMedicalError: (category: string, error: Error, context?: any) => {
    logger.error('Medical Calculation Error', {
      category,
      error: {
        name: error.name,
        message: error.message,
      },
      context: context ? '[SANITIZED]' : undefined,
    });
  },

  // Report authentication errors
  reportAuthError: (action: string, error: Error, userId?: string) => {
    logger.security('Authentication Error', {
      action,
      error: error.message,
      user_id: userId,
    });
  },
};

export default ErrorBoundary;