import React, { useEffect } from 'react';
import { ChatInterface } from './components/ChatInterface';
import { ErrorBoundary, setupGlobalErrorHandlers } from './components/ErrorBoundary';
import { logger } from './lib/logger';
import { cacheManager } from './lib/cache';

export default function App() {
  useEffect(() => {
    // Setup global error handlers
    setupGlobalErrorHandlers();
    
    // Initialize cache warm-up
    cacheManager.warmUp().catch(error => {
      logger.error('Cache warm-up failed:', error);
    });

    // Log application start
    logger.info('NelsonGPT application started', {
      version: import.meta.env.VITE_APP_VERSION || '1.0.0',
      environment: import.meta.env.NODE_ENV || 'development',
    });
  }, []);

  return (
    <ErrorBoundary>
      <div className="h-screen w-screen overflow-hidden bg-background text-foreground dark">
        <ChatInterface />
      </div>
    </ErrorBoundary>
  );
}
