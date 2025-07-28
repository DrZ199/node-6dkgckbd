import { supabase } from './supabase';
import { generateResponse, createMedicalSystemPrompt, type MistralMessage } from './mistral';
import { Citation, PediatricReference } from '../types';
import { cacheManager } from './cache';
import { checkMedicalQueryLimit, checkDosageCalculationLimit } from './rateLimit';
import { logger, logMedicalQuery, logPerformance } from './logger';
import { errorReporting, MedicalDataError } from '../components/ErrorBoundary';

// HuggingFace embedding service
const HUGGINGFACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY;
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

async function generateEmbedding(text: string): Promise<number[]> {
  const startTime = Date.now();
  
  // Check cache first
  const cachedEmbedding = await cacheManager.getEmbedding(text);
  if (cachedEmbedding) {
    logPerformance('Embedding cache hit', Date.now() - startTime);
    return cachedEmbedding;
  }

  if (!HUGGINGFACE_API_KEY) {
    logger.warn('HuggingFace API key not found, using mock embeddings');
    const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
    await cacheManager.setEmbedding(text, mockEmbedding, 60 * 60); // Cache for 1 hour
    return mockEmbedding;
  }

  try {
    const response = await fetch(
      `https://api-inference.huggingface.co/models/${EMBEDDING_MODEL}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${HUGGINGFACE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          inputs: text,
          options: { wait_for_model: true }
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HuggingFace API error: ${response.statusText}`);
    }

    const embeddings = await response.json();
    const embedding = Array.isArray(embeddings) ? embeddings : embeddings[0];
    
    // Cache the embedding
    await cacheManager.setEmbedding(text, embedding);
    
    logPerformance('Embedding generation', Date.now() - startTime);
    return embedding;
  } catch (error) {
    logger.error('Embedding generation failed:', error);
    errorReporting.reportApiError('huggingface-embeddings', error as Error, { text: '[REDACTED]' });
    
    const fallbackEmbedding = new Array(384).fill(0).map(() => Math.random());
    await cacheManager.setEmbedding(text, fallbackEmbedding, 60 * 60); // Cache fallback for 1 hour
    return fallbackEmbedding;
  }
}

export async function searchMedicalKnowledge(
  query: string,
  limit: number = 5
): Promise<PediatricReference[]> {
  try {
    // Generate embedding for the query
    const queryEmbedding = await generateEmbedding(query);

    // Search Supabase for similar content using cosine similarity
    const { data, error } = await supabase.rpc('search_medical_content', {
      query_embedding: queryEmbedding,
      match_count: limit,
      similarity_threshold: 0.7
    });

    if (error) {
      console.error('Supabase search error:', error);
      return [];
    }

    return data?.map((item: any) => ({
      id: item.id,
      title: item.title,
      content: item.content,
      chapter: item.chapter,
      page: item.page,
      tags: item.tags || [],
      lastUpdated: new Date(item.updated_at)
    })) || [];
  } catch (error) {
    console.error('Medical knowledge search failed:', error);
    return [];
  }
}

export async function generateMedicalResponse(
  userQuery: string,
  conversationHistory: MistralMessage[] = [],
  userId?: string
): Promise<{ response: string; citations: Citation[] }> {
  const startTime = Date.now();
  
  try {
    // Check rate limit
    const canProceed = await checkMedicalQueryLimit(userQuery);
    if (!canProceed) {
      throw new MedicalDataError('Rate limit exceeded for medical queries', 'query');
    }

    // Check cache for similar queries
    const cachedResponse = await cacheManager.getSearchResults(userQuery);
    if (cachedResponse) {
      logPerformance('Medical response cache hit', Date.now() - startTime);
      logMedicalQuery(userQuery, userId, Date.now() - startTime);
      return cachedResponse;
    }

    // Search for relevant medical content
    const relevantContent = await searchMedicalKnowledge(userQuery);
    
    if (relevantContent.length === 0) {
      logger.warn('No relevant medical content found for query', {
        query_length: userQuery.length,
        user_id: userId,
      });
    }
    
    // Create citations from retrieved content
    const citations: Citation[] = relevantContent.map(ref => ({
      source: `Nelson Textbook of Pediatrics, ${ref.chapter}`,
      page: ref.page,
      chapter: ref.chapter,
      relevance: 0.8 // This would be calculated from similarity score
    }));

    // Build context from retrieved content
    const context = relevantContent.length > 0 
      ? relevantContent.map(ref => 
          `**${ref.title}** (${ref.chapter}, p. ${ref.page}):\n${ref.content}`
        ).join('\n\n')
      : '';

    // Construct the prompt with context
    const systemPrompt = createMedicalSystemPrompt();
    const contextPrompt = context
      ? `\n\n**Retrieved Context from Nelson Textbook of Pediatrics:**\n${context}\n\n**User Question:** ${userQuery}`
      : `\n\n**User Question:** ${userQuery}`;

    const messages: MistralMessage[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory.slice(-6), // Keep last 6 messages for context
      { role: 'user', content: contextPrompt }
    ];

    // Generate response using Mistral
    const response = await generateResponse(messages, 0.3, 2048);

    const result = {
      response,
      citations
    };

    // Cache the response
    await cacheManager.setSearchResults(userQuery, result, 10 * 60); // Cache for 10 minutes

    // Log the medical query
    const duration = Date.now() - startTime;
    logMedicalQuery(userQuery, userId, duration);
    logPerformance('Medical response generation', duration);

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error('Medical response generation failed:', error);
    errorReporting.reportMedicalError('response_generation', error as Error, {
      query_length: userQuery.length,
      user_id: userId,
      duration_ms: duration,
    });

    if (error instanceof MedicalDataError) {
      throw error; // Re-throw medical data errors
    }

    return {
      response: 'I apologize, but I encountered an error while processing your request. Please try again or contact support if the issue persists.',
      citations: []
    };
  }
}

// Drug dosage calculator
export function calculatePediatricDosage({
  drugName,
  dosePerKg,
  patientWeight,
  maxDose,
  frequency
}: {
  drugName: string;
  dosePerKg: number;
  patientWeight: number;
  maxDose?: number;
  frequency: string;
}): string {
  const calculatedDose = dosePerKg * patientWeight;
  const finalDose = maxDose ? Math.min(calculatedDose, maxDose) : calculatedDose;
  
  return `**${drugName} Dosage Calculation:**\n\n` +
    `- Patient weight: ${patientWeight} kg\n` +
    `- Dose per kg: ${dosePerKg} mg/kg\n` +
    `- Calculated dose: ${calculatedDose.toFixed(1)} mg\n` +
    `${maxDose ? `- Maximum dose: ${maxDose} mg\n` : ''}` +
    `- **Recommended dose: ${finalDose.toFixed(1)} mg ${frequency}**\n\n` +
    `*Always verify dosing with current guidelines and consider patient-specific factors.*`;
}