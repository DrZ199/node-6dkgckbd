import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Mock environment variables
vi.mock('../lib/supabase', () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => Promise.resolve({ data: [], error: null })),
      insert: vi.fn(() => Promise.resolve({ data: null, error: null })),
      update: vi.fn(() => Promise.resolve({ data: null, error: null })),
      delete: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  },
  supabaseAdmin: null,
}));

// Mock Mistral AI
vi.mock('../lib/mistral', () => ({
  generateResponse: vi.fn(() => Promise.resolve('Mocked medical response')),
  createMedicalSystemPrompt: vi.fn(() => 'Mocked system prompt'),
}));

// Mock HuggingFace API
global.fetch = vi.fn();

// Mock localStorage
Object.defineProperty(window, 'localStorage', {
  value: {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
  },
  writable: true,
});

// Mock crypto for UUID generation
Object.defineProperty(global, 'crypto', {
  value: {
    randomUUID: () => 'mock-uuid-1234',
  },
});

// Setup environment variables for tests
process.env.VITE_SUPABASE_URL = 'https://test.supabase.co';
process.env.VITE_SUPABASE_ANON_KEY = 'test-anon-key';
process.env.VITE_MISTRAL_API_KEY = 'test-mistral-key';
process.env.VITE_HUGGINGFACE_API_KEY = 'test-hf-key';