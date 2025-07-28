import { StateGraph, END } from '@langchain/langgraph';
import { BaseMessage, HumanMessage, AIMessage, SystemMessage } from '@langchain/core/messages';
import { logger } from '../../logger';
import { VectorSearchTool } from '../tools/vectorSearch';
import { DosageCalculatorTool } from '../tools/dosageCalculator';
import { EmergencyProtocolTool } from '../tools/emergencyProtocol';
import { createMistralModel } from '../index';
import { CitationManager } from '../citation/citationManager';

// Medical workflow state interface
export interface MedicalWorkflowState {
  messages: BaseMessage[];
  query: string;
  queryType: string;
  patientContext?: {
    age?: string;
    weight?: number;
    symptoms?: string[];
    medications?: string[];
    allergies?: string[];
    vitals?: Record<string, any>;
  };
  searchResults?: any[];
  citations?: any[];
  recommendations?: string[];
  riskLevel?: 'low' | 'medium' | 'high' | 'critical';
  nextAction?: string;
  confidence?: number;
  requiresEscalation?: boolean;
  emergencyProtocol?: boolean;
  dosageCalculations?: any[];
  finalResponse?: string;
  metadata?: Record<string, any>;
}

export class MedicalWorkflowGraph {
  private graph: StateGraph<MedicalWorkflowState>;
  private vectorSearch: VectorSearchTool;
  private dosageCalculator: DosageCalculatorTool;
  private emergencyProtocol: EmergencyProtocolTool;
  private citationManager: CitationManager;
  private model: any;

  constructor() {
    this.vectorSearch = new VectorSearchTool();
    this.dosageCalculator = new DosageCalculatorTool();
    this.emergencyProtocol = new EmergencyProtocolTool();
    this.citationManager = new CitationManager();
    this.model = createMistralModel(0.3, 2048);
    
    this.graph = this.createWorkflowGraph();
  }

  // Create the main workflow graph
  private createWorkflowGraph(): StateGraph<MedicalWorkflowState> {
    const workflow = new StateGraph<MedicalWorkflowState>({
      channels: {
        messages: [],
        query: '',
        queryType: '',
        patientContext: {},
        searchResults: [],
        citations: [],
        recommendations: [],
        riskLevel: 'low',
        nextAction: '',
        confidence: 0,
        requiresEscalation: false,
        emergencyProtocol: false,
        dosageCalculations: [],
        finalResponse: '',
        metadata: {},
      }
    });

    // Add nodes
    workflow.addNode('analyzeQuery', this.analyzeQuery.bind(this));
    workflow.addNode('extractPatientContext', this.extractPatientContext.bind(this));
    workflow.addNode('assessRisk', this.assessRisk.bind(this));
    workflow.addNode('searchMedicalContent', this.searchMedicalContent.bind(this));
    workflow.addNode('handleEmergency', this.handleEmergency.bind(this));
    workflow.addNode('calculateDosage', this.calculateDosage.bind(this));
    workflow.addNode('generateRecommendations', this.generateRecommendations.bind(this));
    workflow.addNode('synthesizeResponse', this.synthesizeResponse.bind(this));
    workflow.addNode('escalateToSpecialist', this.escalateToSpecialist.bind(this));

    // Define edges and conditional routing
    workflow.addEdge('analyzeQuery', 'extractPatientContext');
    workflow.addEdge('extractPatientContext', 'assessRisk');
    
    workflow.addConditionalEdges(
      'assessRisk',
      this.routeBasedOnRisk.bind(this),
      {
        emergency: 'handleEmergency',
        dosage: 'calculateDosage',
        search: 'searchMedicalContent',
        escalate: 'escalateToSpecialist',
      }
    );

    workflow.addEdge('searchMedicalContent', 'generateRecommendations');
    workflow.addEdge('handleEmergency', 'synthesizeResponse');
    workflow.addEdge('calculateDosage', 'synthesizeResponse');
    workflow.addEdge('generateRecommendations', 'synthesizeResponse');
    
    workflow.addConditionalEdges(
      'synthesizeResponse',
      this.shouldEscalate.bind(this),
      {
        escalate: 'escalateToSpecialist',
        end: END,
      }
    );

    workflow.addEdge('escalateToSpecialist', END);

    // Set entry point
    workflow.setEntryPoint('analyzeQuery');

    return workflow;
  }

  // Analyze the incoming query
  async analyzeQuery(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      logger.info('Analyzing medical query', { query: state.query });

      const analysisPrompt = `Analyze this medical query and determine:
1. Query type (emergency, dosage_calculation, symptom_analysis, general_medical, drug_information)
2. Key medical concepts
3. Any patient context mentioned
4. Urgency level

Query: "${state.query}"

Respond with JSON format:
{
  "queryType": "type",
  "concepts": ["concept1", "concept2"],
  "urgencyLevel": "low|medium|high|critical",
  "requiresPatientData": boolean,
  "containsEmergencyTerms": boolean
}`;

      const response = await this.model.invoke([
        new SystemMessage('You are a medical query analyzer. Return only valid JSON.'),
        new HumanMessage(analysisPrompt)
      ]);

      let analysis;
      try {
        analysis = JSON.parse(response.content);
      } catch (error) {
        // Fallback analysis
        analysis = this.fallbackQueryAnalysis(state.query);
      }

      return {
        queryType: analysis.queryType || 'general_medical',
        riskLevel: analysis.urgencyLevel || 'low',
        emergencyProtocol: analysis.containsEmergencyTerms || false,
        metadata: {
          ...state.metadata,
          concepts: analysis.concepts || [],
          requiresPatientData: analysis.requiresPatientData || false,
        }
      };
    } catch (error) {
      logger.error('Query analysis failed:', error);
      return {
        queryType: 'general_medical',
        riskLevel: 'low',
        emergencyProtocol: false,
      };
    }
  }

  // Extract patient context from query
  async extractPatientContext(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const extractionPrompt = `Extract patient information from this medical query:
"${state.query}"

Look for:
- Age (years, months, days)
- Weight (kg, lbs)
- Symptoms
- Current medications
- Known allergies
- Vital signs

Return JSON format:
{
  "age": "extracted age or null",
  "weight": weight_in_kg_or_null,
  "symptoms": ["symptom1", "symptom2"],
  "medications": ["med1", "med2"],
  "allergies": ["allergy1"],
  "vitals": {"hr": null, "bp": null, "temp": null}
}`;

      const response = await this.model.invoke([
        new SystemMessage('You are a medical information extractor. Return only valid JSON.'),
        new HumanMessage(extractionPrompt)
      ]);

      let patientContext;
      try {
        patientContext = JSON.parse(response.content);
      } catch (error) {
        patientContext = this.fallbackPatientExtraction(state.query);
      }

      return {
        patientContext: {
          ...state.patientContext,
          ...patientContext
        }
      };
    } catch (error) {
      logger.error('Patient context extraction failed:', error);
      return { patientContext: state.patientContext };
    }
  }

  // Assess risk level
  async assessRisk(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const riskFactors = this.analyzeRiskFactors(state);
      const riskLevel = this.calculateRiskLevel(riskFactors);
      
      logger.info('Risk assessment completed', {
        queryType: state.queryType,
        riskLevel,
        factors: riskFactors
      });

      return {
        riskLevel,
        metadata: {
          ...state.metadata,
          riskFactors,
          riskAssessmentTime: new Date().toISOString(),
        }
      };
    } catch (error) {
      logger.error('Risk assessment failed:', error);
      return { riskLevel: 'medium' };
    }
  }

  // Search medical content
  async searchMedicalContent(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const searchResults = await this.vectorSearch._call(state.query);
      const parsedResults = JSON.parse(searchResults);
      
      // Build citations
      const context = this.citationManager.buildContextWithCitations(parsedResults);
      const citations = this.citationManager.getLastCitations();

      return {
        searchResults: parsedResults,
        citations,
        metadata: {
          ...state.metadata,
          searchPerformed: true,
          resultCount: parsedResults.length,
        }
      };
    } catch (error) {
      logger.error('Medical content search failed:', error);
      return {
        searchResults: [],
        citations: [],
      };
    }
  }

  // Handle emergency situations
  async handleEmergency(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const emergencyInput = {
        emergency: state.query,
        age: state.patientContext?.age,
        weight: state.patientContext?.weight,
        symptoms: state.patientContext?.symptoms?.join(', '),
      };

      const protocol = await this.emergencyProtocol._call(JSON.stringify(emergencyInput));

      return {
        finalResponse: protocol,
        requiresEscalation: true,
        riskLevel: 'critical',
        emergencyProtocol: true,
        metadata: {
          ...state.metadata,
          emergencyHandled: true,
          protocolApplied: true,
        }
      };
    } catch (error) {
      logger.error('Emergency protocol handling failed:', error);
      return {
        finalResponse: 'Emergency protocol error. Please seek immediate medical attention.',
        requiresEscalation: true,
        riskLevel: 'critical',
      };
    }
  }

  // Calculate dosages
  async calculateDosage(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      // Extract drug information from query
      const drugInfo = this.extractDrugInformation(state.query);
      
      const dosageInput = {
        drugName: drugInfo.drugName,
        weight: state.patientContext?.weight || drugInfo.weight,
        age: state.patientContext?.age || drugInfo.age,
        indication: drugInfo.indication,
        route: drugInfo.route,
      };

      const calculation = await this.dosageCalculator._call(JSON.stringify(dosageInput));

      return {
        dosageCalculations: [calculation],
        finalResponse: calculation,
        metadata: {
          ...state.metadata,
          dosageCalculated: true,
          drugName: drugInfo.drugName,
        }
      };
    } catch (error) {
      logger.error('Dosage calculation failed:', error);
      return {
        dosageCalculations: [],
        finalResponse: 'Unable to calculate dosage. Please consult clinical resources.',
      };
    }
  }

  // Generate recommendations
  async generateRecommendations(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const recommendationPrompt = `Based on the search results and patient context, provide medical recommendations.

Query: ${state.query}
Patient Context: ${JSON.stringify(state.patientContext)}
Search Results: ${JSON.stringify(state.searchResults?.slice(0, 3))}

Provide evidence-based recommendations with proper Nelson citations.`;

      const response = await this.model.invoke([
        new SystemMessage('You are NelsonGPT. Provide evidence-based recommendations with citations.'),
        new HumanMessage(recommendationPrompt)
      ]);

      const recommendations = this.parseRecommendations(response.content);

      return {
        recommendations,
        confidence: this.calculateConfidence(state),
        metadata: {
          ...state.metadata,
          recommendationsGenerated: true,
          recommendationCount: recommendations.length,
        }
      };
    } catch (error) {
      logger.error('Recommendation generation failed:', error);
      return {
        recommendations: ['Unable to generate recommendations. Please consult clinical resources.'],
        confidence: 0.3,
      };
    }
  }

  // Synthesize final response
  async synthesizeResponse(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      if (state.finalResponse) {
        // Already have a final response (from emergency or dosage)
        return { finalResponse: state.finalResponse };
      }

      let response = '';
      
      if (state.recommendations && state.recommendations.length > 0) {
        response = state.recommendations.join('\n\n');
      }

      // Add citations if available
      if (state.citations && state.citations.length > 0) {
        response += this.citationManager.getFormattedCitations();
      }

      // Add confidence and escalation notice
      if (state.confidence && state.confidence < 0.7) {
        response += '\n\n**Note:** This response has moderate confidence. Consider consulting additional resources or a specialist.';
      }

      return {
        finalResponse: response,
        metadata: {
          ...state.metadata,
          responseGenerated: true,
          responseLength: response.length,
        }
      };
    } catch (error) {
      logger.error('Response synthesis failed:', error);
      return {
        finalResponse: 'Unable to generate response. Please consult clinical resources.',
      };
    }
  }

  // Escalate to specialist
  async escalateToSpecialist(state: MedicalWorkflowState): Promise<Partial<MedicalWorkflowState>> {
    try {
      const escalationMessage = this.generateEscalationMessage(state);
      
      logger.warn('Case escalated to specialist', {
        queryType: state.queryType,
        riskLevel: state.riskLevel,
        reason: 'Complex case requiring specialist input',
      });

      return {
        finalResponse: escalationMessage,
        requiresEscalation: true,
        metadata: {
          ...state.metadata,
          escalated: true,
          escalationReason: 'Complex case requiring specialist input',
        }
      };
    } catch (error) {
      logger.error('Escalation failed:', error);
      return {
        finalResponse: 'This case requires specialist consultation. Please seek appropriate medical care.',
        requiresEscalation: true,
      };
    }
  }

  // Routing logic based on risk assessment
  private routeBasedOnRisk(state: MedicalWorkflowState): string {
    if (state.emergencyProtocol || state.riskLevel === 'critical') {
      return 'emergency';
    }
    
    if (state.queryType === 'dosage_calculation') {
      return 'dosage';
    }
    
    if (state.riskLevel === 'high' && this.shouldEscalateImmediately(state)) {
      return 'escalate';
    }
    
    return 'search';
  }

  // Determine if case should be escalated
  private shouldEscalate(state: MedicalWorkflowState): string {
    if (state.requiresEscalation || 
        state.riskLevel === 'critical' || 
        (state.confidence && state.confidence < 0.5)) {
      return 'escalate';
    }
    return 'end';
  }

  // Helper methods
  private fallbackQueryAnalysis(query: string) {
    const lowerQuery = query.toLowerCase();
    
    let queryType = 'general_medical';
    let urgencyLevel = 'low';
    let containsEmergencyTerms = false;

    if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent') || lowerQuery.includes('critical')) {
      queryType = 'emergency';
      urgencyLevel = 'critical';
      containsEmergencyTerms = true;
    } else if (lowerQuery.includes('dosage') || lowerQuery.includes('dose')) {
      queryType = 'dosage_calculation';
    } else if (lowerQuery.includes('symptom') || lowerQuery.includes('diagnosis')) {
      queryType = 'symptom_analysis';
    }

    return { queryType, urgencyLevel, containsEmergencyTerms };
  }

  private fallbackPatientExtraction(query: string) {
    // Simple regex-based extraction as fallback
    const ageMatch = query.match(/(\d+)\s*(year|month|day)s?\s*old/i);
    const weightMatch = query.match(/(\d+)\s*(kg|pound|lb)/i);
    
    return {
      age: ageMatch ? `${ageMatch[1]} ${ageMatch[2]}s` : null,
      weight: weightMatch ? (weightMatch[2].toLowerCase().includes('kg') ? 
        parseInt(weightMatch[1]) : Math.round(parseInt(weightMatch[1]) * 0.453592)) : null,
      symptoms: [],
      medications: [],
      allergies: [],
      vitals: {},
    };
  }

  private analyzeRiskFactors(state: MedicalWorkflowState) {
    const factors = [];
    
    if (state.emergencyProtocol) factors.push('emergency_protocol');
    if (state.queryType === 'emergency') factors.push('emergency_query');
    if (state.patientContext?.age?.includes('day') || state.patientContext?.age?.includes('neonate')) {
      factors.push('neonatal_patient');
    }
    if (state.patientContext?.symptoms?.some(s => 
      s.toLowerCase().includes('difficulty breathing') || 
      s.toLowerCase().includes('chest pain'))) {
      factors.push('respiratory_distress');
    }
    
    return factors;
  }

  private calculateRiskLevel(factors: string[]): 'low' | 'medium' | 'high' | 'critical' {
    if (factors.includes('emergency_protocol') || factors.includes('emergency_query')) {
      return 'critical';
    }
    if (factors.includes('respiratory_distress') || factors.includes('neonatal_patient')) {
      return 'high';
    }
    if (factors.length > 0) {
      return 'medium';
    }
    return 'low';
  }

  private extractDrugInformation(query: string) {
    // Extract drug information from query
    // This is a simplified version - could be enhanced with NLP
    const drugMatch = query.match(/(?:dosage|dose)\s+(?:of\s+)?([a-zA-Z]+)/i);
    const weightMatch = query.match(/(\d+)\s*kg/i);
    const ageMatch = query.match(/(\d+)\s*(?:year|month)/i);
    
    return {
      drugName: drugMatch ? drugMatch[1] : 'unknown',
      weight: weightMatch ? parseInt(weightMatch[1]) : null,
      age: ageMatch ? ageMatch[0] : null,
      indication: 'not specified',
      route: 'oral',
    };
  }

  private parseRecommendations(content: string): string[] {
    // Parse recommendations from AI response
    const lines = content.split('\n').filter(line => line.trim());
    const recommendations = [];
    
    for (const line of lines) {
      if (line.match(/^\d+\./) || line.startsWith('-') || line.startsWith('•')) {
        recommendations.push(line.trim());
      }
    }
    
    return recommendations.length > 0 ? recommendations : [content];
  }

  private calculateConfidence(state: MedicalWorkflowState): number {
    let confidence = 0.8; // Base confidence
    
    if (state.searchResults && state.searchResults.length > 0) {
      confidence += 0.1;
    }
    if (state.citations && state.citations.length > 2) {
      confidence += 0.1;
    }
    if (state.patientContext?.age && state.patientContext?.weight) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }

  private shouldEscalateImmediately(state: MedicalWorkflowState): boolean {
    return state.metadata?.concepts?.some((concept: string) => 
      concept.toLowerCase().includes('oncology') || 
      concept.toLowerCase().includes('cardiac surgery') ||
      concept.toLowerCase().includes('complex')); 
  }

  private generateEscalationMessage(state: MedicalWorkflowState): string {
    return `**Case Escalation Required**

This case requires specialist consultation due to:
- Risk level: ${state.riskLevel}
- Query type: ${state.queryType}
- Complexity factors identified

**Summary:**
Query: ${state.query}
Patient context: ${JSON.stringify(state.patientContext)}
Confidence level: ${state.confidence || 'Not calculated'}

**Recommendation:** Please consult with appropriate medical specialists and follow institutional protocols for complex cases.

**References:** Refer to Nelson Textbook of Pediatrics for comprehensive guidance on specialist referral criteria.`;
  }

  // Main execution method
  async execute(query: string, patientContext?: any): Promise<{
    response: string;
    citations: any[];
    metadata: any;
  }> {
    try {
      const initialState: MedicalWorkflowState = {
        messages: [new HumanMessage(query)],
        query,
        queryType: '',
        patientContext,
        searchResults: [],
        citations: [],
        recommendations: [],
        riskLevel: 'low',
        nextAction: '',
        confidence: 0,
        requiresEscalation: false,
        emergencyProtocol: false,
        dosageCalculations: [],
        finalResponse: '',
        metadata: {
          startTime: new Date().toISOString(),
          workflowVersion: '1.0',
        },
      };

      const compiledGraph = this.graph.compile();
      const result = await compiledGraph.invoke(initialState);

      return {
        response: result.finalResponse || 'No response generated',
        citations: result.citations || [],
        metadata: {
          ...result.metadata,
          endTime: new Date().toISOString(),
          riskLevel: result.riskLevel,
          requiresEscalation: result.requiresEscalation,
          confidence: result.confidence,
        },
      };
    } catch (error) {
      logger.error('Workflow execution failed:', error);
      return {
        response: 'An error occurred while processing your request. Please try again or consult medical resources.',
        citations: [],
        metadata: { error: error.message },
      };
    }
  }
}