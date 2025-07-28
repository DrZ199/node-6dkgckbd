import { logger, logMedicalQuery } from '../logger';
import { checkMedicalQueryLimit } from '../rateLimit';
import { MedicalDataError } from '../components/ErrorBoundary';
import { MedicalWorkflowGraph } from './workflow/medicalWorkflow';
import { CachedMedicalRAGChain } from './index';
import { authService } from '../auth';

export interface MedicalAIRequest {
  query: string;
  userId?: string;
  sessionId?: string;
  patientContext?: {
    age?: string;
    weight?: number;
    symptoms?: string[];
    medications?: string[];
    allergies?: string[];
    vitals?: Record<string, any>;
  };
  conversationHistory?: any[];
  useWorkflow?: boolean;
  riskTolerance?: 'low' | 'medium' | 'high';
}

export interface MedicalAIResponse {
  response: string;
  citations: any[];
  metadata: {
    queryType: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    confidence: number;
    responseTime: number;
    requiresEscalation: boolean;
    workflowUsed: boolean;
    [key: string]: any;
  };
}

export class MedicalAIService {
  private workflowGraph: MedicalWorkflowGraph;
  private ragChain: CachedMedicalRAGChain;

  constructor() {
    this.workflowGraph = new MedicalWorkflowGraph();
    this.ragChain = new CachedMedicalRAGChain();
  }

  // Main entry point for medical AI queries
  async processQuery(request: MedicalAIRequest): Promise<MedicalAIResponse> {
    const startTime = Date.now();
    
    try {
      // Validate and check permissions
      await this.validateRequest(request);

      // Check rate limiting
      const canProceed = await checkMedicalQueryLimit(request.query);
      if (!canProceed) {
        throw new MedicalDataError('Rate limit exceeded for medical queries', 'query');
      }

      // Determine processing method
      const shouldUseWorkflow = this.shouldUseWorkflow(request);
      
      let result: MedicalAIResponse;

      if (shouldUseWorkflow) {
        result = await this.processWithWorkflow(request);
      } else {
        result = await this.processWithRAG(request);
      }

      // Add timing and user information
      result.metadata.responseTime = Date.now() - startTime;
      result.metadata.workflowUsed = shouldUseWorkflow;

      // Log the query
      logMedicalQuery(request.query, request.userId, result.metadata.responseTime);

      // Log citation usage
      if (result.citations.length > 0) {
        logger.info('Citations generated', {
          user_id: request.userId,
          citation_count: result.citations.length,
          query_type: result.metadata.queryType,
        });
      }

      return result;

    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Medical AI processing failed:', error);

      if (error instanceof MedicalDataError) {
        throw error;
      }

      return {
        response: 'I apologize, but I encountered an error while processing your request. Please try again or contact support if the issue persists.',
        citations: [],
        metadata: {
          queryType: 'error',
          riskLevel: 'low',
          confidence: 0,
          responseTime: duration,
          requiresEscalation: false,
          workflowUsed: false,
          error: error.message,
        },
      };
    }
  }

  // Process using LangGraph workflow for complex queries
  private async processWithWorkflow(request: MedicalAIRequest): Promise<MedicalAIResponse> {
    try {
      logger.info('Processing with LangGraph workflow', {
        user_id: request.userId,
        query_length: request.query.length,
      });

      const result = await this.workflowGraph.execute(request.query, request.patientContext);

      return {
        response: result.response,
        citations: result.citations,
        metadata: {
          queryType: result.metadata.queryType || 'general_medical',
          riskLevel: result.metadata.riskLevel || 'low',
          confidence: result.metadata.confidence || 0.8,
          responseTime: 0, // Will be set in main function
          requiresEscalation: result.metadata.requiresEscalation || false,
          workflowUsed: true,
          workflowVersion: result.metadata.workflowVersion,
          ...result.metadata,
        },
      };
    } catch (error) {
      logger.error('Workflow processing failed:', error);
      throw new Error('Failed to process query with advanced workflow');
    }
  }

  // Process using RAG chain for simple queries
  private async processWithRAG(request: MedicalAIRequest): Promise<MedicalAIResponse> {
    try {
      logger.info('Processing with RAG chain', {
        user_id: request.userId,
        query_length: request.query.length,
      });

      const chatHistory = this.formatConversationHistory(request.conversationHistory);
      const result = await this.ragChain.invoke(request.query, chatHistory);

      return {
        response: result.response,
        citations: result.citations || [],
        metadata: {
          queryType: this.detectQueryType(request.query),
          riskLevel: this.assessBasicRisk(request.query),
          confidence: 0.8,
          responseTime: 0, // Will be set in main function
          requiresEscalation: false,
          workflowUsed: false,
          ragChainUsed: true,
        },
      };
    } catch (error) {
      logger.error('RAG processing failed:', error);
      throw new Error('Failed to process query with RAG system');
    }
  }

  // Validate request and check permissions
  private async validateRequest(request: MedicalAIRequest): Promise<void> {
    if (!request.query || request.query.trim().length === 0) {
      throw new Error('Query cannot be empty');
    }

    if (request.query.length > 10000) {
      throw new Error('Query is too long. Please limit to 10,000 characters.');
    }

    // Check user permissions if authenticated
    if (request.userId) {
      const user = authService.getCurrentUser();
      if (user && !authService.hasPermission('read_content')) {
        throw new Error('Insufficient permissions for medical queries');
      }
    }

    // Check for inappropriate content
    if (this.containsInappropriateContent(request.query)) {
      throw new Error('Query contains inappropriate content');
    }
  }

  // Determine if workflow should be used
  private shouldUseWorkflow(request: MedicalAIRequest): boolean {
    // Force workflow if explicitly requested
    if (request.useWorkflow === true) {
      return true;
    }

    // Don't use workflow if explicitly disabled
    if (request.useWorkflow === false) {
      return false;
    }

    // Use workflow for complex queries
    const query = request.query.toLowerCase();
    
    // Emergency situations
    if (query.includes('emergency') || query.includes('urgent') || query.includes('critical')) {
      return true;
    }

    // Dosage calculations
    if (query.includes('dosage') || query.includes('dose') || query.includes('mg/kg')) {
      return true;
    }

    // Complex symptoms or multiple conditions
    if (this.hasMultipleSymptoms(query) || this.hasComplexMedicalTerms(query)) {
      return true;
    }

    // Patient context provided
    if (request.patientContext && Object.keys(request.patientContext).length > 1) {
      return true;
    }

    // High risk tolerance requires workflow
    if (request.riskTolerance === 'low') {
      return true;
    }

    return false;
  }

  // Format conversation history for RAG
  private formatConversationHistory(history?: any[]): string {
    if (!history || history.length === 0) {
      return '';
    }

    return history
      .slice(-6) // Last 6 messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n');
  }

  // Detect query type for simple classification
  private detectQueryType(query: string): string {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('dosage') || lowerQuery.includes('dose')) {
      return 'dosage_calculation';
    }
    if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent')) {
      return 'emergency';
    }
    if (lowerQuery.includes('symptom') || lowerQuery.includes('diagnosis')) {
      return 'symptom_analysis';
    }
    if (lowerQuery.includes('growth') || lowerQuery.includes('development')) {
      return 'growth_development';
    }
    
    return 'general_medical';
  }

  // Basic risk assessment for RAG queries
  private assessBasicRisk(query: string): 'low' | 'medium' | 'high' | 'critical' {
    const lowerQuery = query.toLowerCase();
    
    if (lowerQuery.includes('emergency') || lowerQuery.includes('critical') || lowerQuery.includes('urgent')) {
      return 'critical';
    }
    if (lowerQuery.includes('severe') || lowerQuery.includes('acute')) {
      return 'high';
    }
    if (lowerQuery.includes('chronic') || lowerQuery.includes('persistent')) {
      return 'medium';
    }
    
    return 'low';
  }

  // Check for inappropriate content
  private containsInappropriateContent(query: string): boolean {
    const inappropriateTerms = [
      'illegal drug',
      'recreational drug',
      'substance abuse',
      // Add more terms as needed
    ];

    const lowerQuery = query.toLowerCase();
    return inappropriateTerms.some(term => lowerQuery.includes(term));
  }

  // Check for multiple symptoms
  private hasMultipleSymptoms(query: string): boolean {
    const symptomKeywords = ['fever', 'pain', 'nausea', 'vomiting', 'rash', 'cough', 'difficulty breathing'];
    const foundSymptoms = symptomKeywords.filter(symptom => 
      query.toLowerCase().includes(symptom)
    );
    return foundSymptoms.length > 1;
  }

  // Check for complex medical terms
  private hasComplexMedicalTerms(query: string): boolean {
    const complexTerms = [
      'differential diagnosis',
      'comorbid',
      'contraindication',
      'pharmacokinetic',
      'pathophysiology',
      'multisystem',
    ];

    const lowerQuery = query.toLowerCase();
    return complexTerms.some(term => lowerQuery.includes(term));
  }

  // Get system status and statistics
  async getSystemStatus(): Promise<{
    status: 'healthy' | 'degraded' | 'error';
    components: Record<string, any>;
    statistics: Record<string, any>;
  }> {
    try {
      const workflowStatus = await this.checkWorkflowHealth();
      const ragStatus = await this.checkRAGHealth();

      return {
        status: workflowStatus.healthy && ragStatus.healthy ? 'healthy' : 'degraded',
        components: {
          workflow: workflowStatus,
          rag: ragStatus,
        },
        statistics: {
          // Add usage statistics here
        },
      };
    } catch (error) {
      logger.error('System status check failed:', error);
      return {
        status: 'error',
        components: {},
        statistics: {},
      };
    }
  }

  // Check workflow system health
  private async checkWorkflowHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Simple test query
      const testResult = await this.workflowGraph.execute('test query', {});
      return {
        healthy: true,
        details: { lastTest: new Date().toISOString() },
      };
    } catch (error) {
      return {
        healthy: false,
        details: { error: error.message },
      };
    }
  }

  // Check RAG system health
  private async checkRAGHealth(): Promise<{ healthy: boolean; details: any }> {
    try {
      // Simple test query
      const testResult = await this.ragChain.invoke('test query');
      return {
        healthy: true,
        details: { lastTest: new Date().toISOString() },
      };
    } catch (error) {
      return {
        healthy: false,
        details: { error: error.message },
      };
    }
  }
}

// Create singleton instance
export const medicalAI = new MedicalAIService();

// Convenience function for simple queries
export async function queryMedicalAI(
  query: string,
  options: Partial<MedicalAIRequest> = {}
): Promise<MedicalAIResponse> {
  return medicalAI.processQuery({
    query,
    ...options,
  });
}

export default medicalAI;