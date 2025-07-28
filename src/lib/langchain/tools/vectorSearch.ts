import { Tool } from '@langchain/core/tools';
import { supabase } from '../../supabase';
import { logger, logDatabaseOperation } from '../../logger';
import { cacheManager } from '../../cache';
import CryptoJS from 'crypto-js';

// HuggingFace embedding service
const HUGGINGFACE_API_KEY = import.meta.env.VITE_HUGGINGFACE_API_KEY;
const EMBEDDING_MODEL = 'sentence-transformers/all-MiniLM-L6-v2';

interface SearchResult {
  id: string;
  title: string;
  content: string;
  chapter: string;
  page: number;
  tags: string[];
  similarity: number;
  updated_at: string;
}

interface DrugDosageResult {
  id: string;
  drug_name: string;
  indication: string;
  route: string;
  dose_per_kg: number;
  max_dose: number;
  frequency: string;
  contraindications: string[];
  similarity: number;
}

export class VectorSearchTool extends Tool {
  name = 'vector_search_nelson';
  description = `Search the Nelson Textbook of Pediatrics using semantic similarity. 
  Input should be a medical query or symptom description.
  Returns relevant passages with page numbers for citations.
  Example input: "fever in toddlers" or "asthma management"`;

  constructor() {
    super();
  }

  // Generate embeddings for search queries
  private async generateEmbedding(text: string): Promise<number[]> {
    const startTime = Date.now();
    
    // Check cache first
    const cachedEmbedding = await cacheManager.getEmbedding(text);
    if (cachedEmbedding) {
      logger.debug('Using cached embedding for search query');
      return cachedEmbedding;
    }

    if (!HUGGINGFACE_API_KEY) {
      logger.warn('HuggingFace API key not found, using mock embeddings');
      const mockEmbedding = new Array(384).fill(0).map(() => Math.random());
      await cacheManager.setEmbedding(text, mockEmbedding, 60 * 60);
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
      
      logger.debug(`Generated embedding in ${Date.now() - startTime}ms`);
      return embedding;
    } catch (error) {
      logger.error('Embedding generation failed:', error);
      const fallbackEmbedding = new Array(384).fill(0).map(() => Math.random());
      await cacheManager.setEmbedding(text, fallbackEmbedding, 60 * 60);
      return fallbackEmbedding;
    }
  }

  // Search medical content
  private async searchMedicalContent(
    queryEmbedding: number[],
    limit: number = 5,
    similarityThreshold: number = 0.7
  ): Promise<SearchResult[]> {
    const startTime = Date.now();

    try {
      const { data, error } = await supabase.rpc('search_medical_content', {
        query_embedding: queryEmbedding,
        match_count: limit,
        similarity_threshold: similarityThreshold
      });

      logDatabaseOperation('search_medical_content', 'nelson_book_of_pediatrics', Date.now() - startTime, error);

      if (error) {
        logger.error('Supabase medical content search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logDatabaseOperation('search_medical_content', 'nelson_book_of_pediatrics', Date.now() - startTime, error);
      logger.error('Medical content search failed:', error);
      return [];
    }
  }

  // Search drug dosages
  private async searchDrugDosages(
    queryEmbedding: number[],
    limit: number = 3,
    similarityThreshold: number = 0.7
  ): Promise<DrugDosageResult[]> {
    const startTime = Date.now();

    try {
      const { data, error } = await supabase.rpc('search_drug_dosages', {
        query_embedding: queryEmbedding,
        match_count: limit,
        similarity_threshold: similarityThreshold
      });

      logDatabaseOperation('search_drug_dosages', 'pediatric_drug_dosages', Date.now() - startTime, error);

      if (error) {
        logger.error('Supabase drug dosage search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logDatabaseOperation('search_drug_dosages', 'pediatric_drug_dosages', Date.now() - startTime, error);
      logger.error('Drug dosage search failed:', error);
      return [];
    }
  }

  // Search additional medical resources
  private async searchMedicalResources(
    queryEmbedding: number[],
    resourceType?: string,
    limit: number = 3
  ): Promise<any[]> {
    const startTime = Date.now();

    try {
      let query = supabase
        .from('pediatric_medical_resource')
        .select('*')
        .order('embedding <=> ' + JSON.stringify(queryEmbedding))
        .limit(limit);

      if (resourceType) {
        query = query.eq('resource_type', resourceType);
      }

      const { data, error } = await query;

      logDatabaseOperation('search_medical_resources', 'pediatric_medical_resource', Date.now() - startTime, error);

      if (error) {
        logger.error('Medical resources search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logDatabaseOperation('search_medical_resources', 'pediatric_medical_resource', Date.now() - startTime, error);
      logger.error('Medical resources search failed:', error);
      return [];
    }
  }

  // Format search results for context
  private formatSearchResults(
    medicalContent: SearchResult[],
    drugDosages: DrugDosageResult[],
    additionalResources: any[]
  ): string {
    let formattedResults = '';

    // Format medical content
    if (medicalContent.length > 0) {
      formattedResults += '**Medical Content from Nelson Textbook:**\n\n';
      medicalContent.forEach((result, index) => {
        formattedResults += `${index + 1}. **${result.title}** (Nelson, pg. ${result.page})\n`;
        formattedResults += `   Chapter: ${result.chapter}\n`;
        formattedResults += `   Content: ${result.content.substring(0, 300)}...\n`;
        formattedResults += `   Relevance: ${(result.similarity * 100).toFixed(1)}%\n\n`;
      });
    }

    // Format drug dosages
    if (drugDosages.length > 0) {
      formattedResults += '**Drug Dosage Information:**\n\n';
      drugDosages.forEach((drug, index) => {
        formattedResults += `${index + 1}. **${drug.drug_name}** for ${drug.indication}\n`;
        formattedResults += `   Route: ${drug.route}\n`;
        formattedResults += `   Dose: ${drug.dose_per_kg} mg/kg\n`;
        formattedResults += `   Max dose: ${drug.max_dose} mg\n`;
        formattedResults += `   Frequency: ${drug.frequency}\n`;
        if (drug.contraindications && drug.contraindications.length > 0) {
          formattedResults += `   Contraindications: ${drug.contraindications.join(', ')}\n`;
        }
        formattedResults += `   Relevance: ${(drug.similarity * 100).toFixed(1)}%\n\n`;
      });
    }

    // Format additional resources
    if (additionalResources.length > 0) {
      formattedResults += '**Additional Resources:**\n\n';
      additionalResources.forEach((resource, index) => {
        formattedResults += `${index + 1}. **${resource.title}** (${resource.resource_type})\n`;
        formattedResults += `   ${resource.content.substring(0, 200)}...\n`;
        if (resource.source) {
          formattedResults += `   Source: ${resource.source}\n`;
        }
        formattedResults += '\n';
      });
    }

    return formattedResults || 'No relevant medical information found in the Nelson Textbook database.';
  }

  // Check cache for search results
  private async getCachedResults(query: string): Promise<string | null> {
    const cacheKey = CryptoJS.SHA256(query.toLowerCase()).toString();
    return await cacheManager.get('search', cacheKey);
  }

  // Cache search results
  private async cacheResults(query: string, results: string): Promise<void> {
    const cacheKey = CryptoJS.SHA256(query.toLowerCase()).toString();
    await cacheManager.set('search', cacheKey, results, 15 * 60); // 15 minutes
  }

  // Main search execution
  async _call(query: string): Promise<string> {
    const startTime = Date.now();
    
    try {
      logger.info('Vector search initiated', { 
        query_length: query.length, 
        query_type: this.detectQueryType(query) 
      });

      // Check cache first
      const cachedResults = await this.getCachedResults(query);
      if (cachedResults) {
        logger.debug('Using cached search results');
        return cachedResults;
      }

      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);

      // Determine search strategy based on query type
      const queryType = this.detectQueryType(query);
      const searchPromises: Promise<any>[] = [];

      // Always search main medical content
      searchPromises.push(this.searchMedicalContent(queryEmbedding, 5, 0.7));

      // Add drug-specific searches if query is about medications
      if (queryType === 'drug_dosage' || queryType === 'medication') {
        searchPromises.push(this.searchDrugDosages(queryEmbedding, 3, 0.6));
      } else {
        searchPromises.push(Promise.resolve([]));
      }

      // Add resource-specific searches based on query type
      if (queryType === 'emergency') {
        searchPromises.push(this.searchMedicalResources(queryEmbedding, 'emergency_protocol', 2));
      } else if (queryType === 'growth_development') {
        searchPromises.push(this.searchMedicalResources(queryEmbedding, 'growth_chart', 2));
      } else {
        searchPromises.push(this.searchMedicalResources(queryEmbedding, undefined, 2));
      }

      // Execute all searches in parallel
      const [medicalContent, drugDosages, additionalResources] = await Promise.all(searchPromises);

      // Format results
      const formattedResults = this.formatSearchResults(
        medicalContent,
        drugDosages,
        additionalResources
      );

      // Cache the results
      await this.cacheResults(query, formattedResults);

      // Log performance
      const duration = Date.now() - startTime;
      logger.info('Vector search completed', {
        duration_ms: duration,
        results_count: medicalContent.length + drugDosages.length + additionalResources.length,
        query_type: queryType
      });

      return formattedResults;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Vector search failed', {
        error: error.message,
        duration_ms: duration,
        query_length: query.length
      });

      return `Error searching medical database: ${error.message}. Please try rephrasing your query or contact support if the issue persists.`;
    }
  }

  // Detect query type for optimized searching
  private detectQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('dosage') || lowerQuery.includes('dose') || lowerQuery.includes('medication') || lowerQuery.includes('mg/kg')) {
      return 'drug_dosage';
    }
    if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent') || lowerQuery.includes('critical') || lowerQuery.includes('resuscitation')) {
      return 'emergency';
    }
    if (lowerQuery.includes('growth') || lowerQuery.includes('development') || lowerQuery.includes('milestone') || lowerQuery.includes('percentile')) {
      return 'growth_development';
    }
    if (lowerQuery.includes('symptom') || lowerQuery.includes('diagnosis') || lowerQuery.includes('differential')) {
      return 'symptom_analysis';
    }
    if (lowerQuery.includes('vaccine') || lowerQuery.includes('immunization') || lowerQuery.includes('schedule')) {
      return 'vaccine_schedule';
    }
    
    return 'general_medical';
  }

  // Get search statistics
  async getSearchStats(): Promise<any> {
    try {
      const { data: contentCount } = await supabase
        .from('nelson_book_of_pediatrics')
        .select('id', { count: 'exact' });

      const { data: drugCount } = await supabase
        .from('pediatric_drug_dosages')
        .select('id', { count: 'exact' });

      const { data: resourceCount } = await supabase
        .from('pediatric_medical_resource')
        .select('id', { count: 'exact' });

      return {
        medical_content_count: contentCount?.length || 0,
        drug_dosage_count: drugCount?.length || 0,
        medical_resource_count: resourceCount?.length || 0,
        cache_stats: cacheManager.getCacheStats('search')
      };
    } catch (error) {
      logger.error('Failed to get search statistics:', error);
      return { error: 'Failed to retrieve statistics' };
    }
  }
}