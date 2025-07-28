import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MedicalWorkflowGraph } from '../workflow/medicalWorkflow';
import { VectorSearchTool } from '../tools/vectorSearch';
import { DosageCalculatorTool } from '../tools/dosageCalculator';
import { EmergencyProtocolTool } from '../tools/emergencyProtocol';

// Mock the tools
vi.mock('../tools/vectorSearch');
vi.mock('../tools/dosageCalculator');
vi.mock('../tools/emergencyProtocol');
vi.mock('../../logger');
vi.mock('../index');
vi.mock('../citation/citationManager');

// Mock LangChain modules
vi.mock('@langchain/langgraph', () => ({
  StateGraph: vi.fn().mockImplementation(() => ({
    addNode: vi.fn(),
    addEdge: vi.fn(),
    addConditionalEdges: vi.fn(),
    setEntryPoint: vi.fn(),
    compile: vi.fn().mockReturnValue({
      invoke: vi.fn().mockResolvedValue({
        finalResponse: 'Test response',
        citations: [],
        metadata: {
          queryType: 'general_medical',
          riskLevel: 'low',
          confidence: 0.8,
        },
      }),
    }),
  })),
  END: 'END',
}));

vi.mock('@langchain/core/messages', () => ({
  BaseMessage: class BaseMessage {},
  HumanMessage: class HumanMessage {
    constructor(public content: string) {}
  },
  AIMessage: class AIMessage {
    constructor(public content: string) {}
  },
  SystemMessage: class SystemMessage {
    constructor(public content: string) {}
  },
}));

describe('MedicalWorkflowGraph', () => {
  let workflow: MedicalWorkflowGraph;
  let mockVectorSearch: any;
  let mockDosageCalculator: any;
  let mockEmergencyProtocol: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Setup tool mocks
    mockVectorSearch = {
      _call: vi.fn().mockResolvedValue(JSON.stringify([
        {
          id: 'test-id',
          title: 'Test Medical Content',
          content: 'Test content about pediatric medicine',
          chapter: 'Test Chapter',
          page: 123,
          similarity: 0.9,
        }
      ])),
    };

    mockDosageCalculator = {
      _call: vi.fn().mockResolvedValue('Calculated dosage: 10mg/kg'),
    };

    mockEmergencyProtocol = {
      _call: vi.fn().mockResolvedValue('Emergency protocol activated'),
    };

    (VectorSearchTool as any).mockImplementation(() => mockVectorSearch);
    (DosageCalculatorTool as any).mockImplementation(() => mockDosageCalculator);
    (EmergencyProtocolTool as any).mockImplementation(() => mockEmergencyProtocol);

    workflow = new MedicalWorkflowGraph();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Workflow Execution', () => {
    it('should execute a simple medical query', async () => {
      const query = 'What is the treatment for fever in children?';
      const result = await workflow.execute(query);

      expect(result).toBeDefined();
      expect(result.response).toBe('Test response');
      expect(result.metadata).toHaveProperty('queryType');
      expect(result.metadata).toHaveProperty('riskLevel');
    });

    it('should handle emergency queries', async () => {
      const query = 'Emergency: child not breathing';
      const result = await workflow.execute(query);

      expect(result).toBeDefined();
      expect(result.response).toBe('Test response');
      expect(result.metadata.queryType).toBeDefined();
    });

    it('should handle dosage calculation queries', async () => {
      const query = 'What is the dosage of amoxicillin for a 15kg child?';
      const patientContext = { weight: 15, age: '3 years' };
      
      const result = await workflow.execute(query, patientContext);

      expect(result).toBeDefined();
      expect(result.response).toBe('Test response');
    });

    it('should include patient context when provided', async () => {
      const query = 'Treatment options for asthma';
      const patientContext = {
        age: '8 years',
        weight: 25,
        symptoms: ['wheezing', 'shortness of breath'],
        medications: ['albuterol'],
        allergies: ['penicillin'],
      };

      const result = await workflow.execute(query, patientContext);

      expect(result).toBeDefined();
      expect(result.metadata).toHaveProperty('queryType');
    });
  });

  describe('Query Analysis', () => {
    it('should analyze emergency queries correctly', async () => {
      const state = {
        query: 'emergency cardiac arrest in child',
        messages: [],
        queryType: '',
        riskLevel: 'low' as const,
        emergencyProtocol: false,
        metadata: {},
      };

      // Access private method for testing
      const result = await (workflow as any).analyzeQuery(state);

      expect(result).toBeDefined();
      expect(result.queryType).toBeDefined();
    });

    it('should analyze dosage queries correctly', async () => {
      const state = {
        query: 'dosage calculation for ibuprofen',
        messages: [],
        queryType: '',
        riskLevel: 'low' as const,
        emergencyProtocol: false,
        metadata: {},
      };

      const result = await (workflow as any).analyzeQuery(state);

      expect(result).toBeDefined();
      expect(result.queryType).toBeDefined();
    });
  });

  describe('Patient Context Extraction', () => {
    it('should extract age from query', () => {
      const query = 'Treatment for 5 year old with fever';
      const result = (workflow as any).fallbackPatientExtraction(query);

      expect(result.age).toBe('5 years');
    });

    it('should extract weight from query', () => {
      const query = 'Dosage for 20kg child';
      const result = (workflow as any).fallbackPatientExtraction(query);

      expect(result.weight).toBe(20);
    });

    it('should convert pounds to kg', () => {
      const query = 'Patient weighs 44 pounds';
      const result = (workflow as any).fallbackPatientExtraction(query);

      expect(result.weight).toBe(20); // 44 lbs ≈ 20 kg
    });
  });

  describe('Risk Assessment', () => {
    it('should assess emergency risk correctly', () => {
      const factors = ['emergency_protocol', 'emergency_query'];
      const riskLevel = (workflow as any).calculateRiskLevel(factors);

      expect(riskLevel).toBe('critical');
    });

    it('should assess respiratory distress as high risk', () => {
      const factors = ['respiratory_distress'];
      const riskLevel = (workflow as any).calculateRiskLevel(factors);

      expect(riskLevel).toBe('high');
    });

    it('should assess neonatal patients as high risk', () => {
      const factors = ['neonatal_patient'];
      const riskLevel = (workflow as any).calculateRiskLevel(factors);

      expect(riskLevel).toBe('high');
    });

    it('should assess no factors as low risk', () => {
      const factors: string[] = [];
      const riskLevel = (workflow as any).calculateRiskLevel(factors);

      expect(riskLevel).toBe('low');
    });
  });

  describe('Routing Logic', () => {
    it('should route emergency queries to emergency handler', () => {
      const state = {
        emergencyProtocol: true,
        riskLevel: 'critical' as const,
        queryType: 'emergency',
      };

      const route = (workflow as any).routeBasedOnRisk(state);
      expect(route).toBe('emergency');
    });

    it('should route dosage queries to dosage calculator', () => {
      const state = {
        emergencyProtocol: false,
        riskLevel: 'low' as const,
        queryType: 'dosage_calculation',
      };

      const route = (workflow as any).routeBasedOnRisk(state);
      expect(route).toBe('dosage');
    });

    it('should route general queries to search', () => {
      const state = {
        emergencyProtocol: false,
        riskLevel: 'low' as const,
        queryType: 'general_medical',
      };

      const route = (workflow as any).routeBasedOnRisk(state);
      expect(route).toBe('search');
    });
  });

  describe('Drug Information Extraction', () => {
    it('should extract drug name from dosage query', () => {
      const query = 'What is the dosage of amoxicillin for children?';
      const drugInfo = (workflow as any).extractDrugInformation(query);

      expect(drugInfo.drugName).toBe('amoxicillin');
    });

    it('should extract weight from dosage query', () => {
      const query = 'Ibuprofen dose for 25kg patient';
      const drugInfo = (workflow as any).extractDrugInformation(query);

      expect(drugInfo.weight).toBe(25);
      expect(drugInfo.drugName).toBe('Ibuprofen');
    });

    it('should handle unknown drugs gracefully', () => {
      const query = 'What is the general dosage information?';
      const drugInfo = (workflow as any).extractDrugInformation(query);

      expect(drugInfo.drugName).toBe('unknown');
    });
  });

  describe('Confidence Calculation', () => {
    it('should calculate higher confidence with more data', () => {
      const state = {
        searchResults: [{ id: '1' }, { id: '2' }],
        citations: [{ id: '1' }, { id: '2' }, { id: '3' }],
        patientContext: { age: '5 years', weight: 20 },
      };

      const confidence = (workflow as any).calculateConfidence(state);
      expect(confidence).toBeGreaterThan(0.8);
    });

    it('should calculate lower confidence with less data', () => {
      const state = {
        searchResults: [],
        citations: [],
        patientContext: {},
      };

      const confidence = (workflow as any).calculateConfidence(state);
      expect(confidence).toBe(0.8); // Base confidence
    });
  });

  describe('Escalation Logic', () => {
    it('should escalate critical risk cases', () => {
      const state = {
        requiresEscalation: false,
        riskLevel: 'critical' as const,
        confidence: 0.8,
      };

      const shouldEscalate = (workflow as any).shouldEscalate(state);
      expect(shouldEscalate).toBe('escalate');
    });

    it('should escalate low confidence cases', () => {
      const state = {
        requiresEscalation: false,
        riskLevel: 'low' as const,
        confidence: 0.4,
      };

      const shouldEscalate = (workflow as any).shouldEscalate(state);
      expect(shouldEscalate).toBe('escalate');
    });

    it('should not escalate normal cases', () => {
      const state = {
        requiresEscalation: false,
        riskLevel: 'low' as const,
        confidence: 0.8,
      };

      const shouldEscalate = (workflow as any).shouldEscalate(state);
      expect(shouldEscalate).toBe('end');
    });
  });

  describe('Error Handling', () => {
    it('should handle workflow execution errors gracefully', async () => {
      // Mock a failing compilation
      const mockCompile = vi.fn().mockReturnValue({
        invoke: vi.fn().mockRejectedValue(new Error('Workflow failed')),
      });

      // Temporarily replace the compile method
      const originalGraph = (workflow as any).graph;
      (workflow as any).graph = {
        ...originalGraph,
        compile: mockCompile,
      };

      const result = await workflow.execute('test query');

      expect(result.response).toContain('An error occurred');
      expect(result.metadata.error).toBeDefined();
    });

    it('should handle tool failures gracefully', async () => {
      mockVectorSearch._call.mockRejectedValue(new Error('Search failed'));

      const result = await workflow.execute('test query');

      // Should still return a response even with tool failures
      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });

  describe('Complex Workflow Scenarios', () => {
    it('should handle multi-step emergency scenario', async () => {
      const query = 'Emergency: 2 year old child, 12kg, not breathing, blue lips';
      const patientContext = {
        age: '2 years',
        weight: 12,
        symptoms: ['not breathing', 'cyanosis'],
      };

      const result = await workflow.execute(query, patientContext);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
      expect(result.metadata.queryType).toBeDefined();
    });

    it('should handle complex dosage scenario with allergies', async () => {
      const query = 'Safe antibiotic dosage for child allergic to penicillin';
      const patientContext = {
        age: '8 years',
        weight: 25,
        allergies: ['penicillin', 'sulfa'],
      };

      const result = await workflow.execute(query, patientContext);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });

    it('should handle symptom analysis with multiple conditions', async () => {
      const query = 'Child with fever, rash, and joint pain - differential diagnosis';
      const patientContext = {
        age: '10 years',
        symptoms: ['fever', 'rash', 'joint pain'],
        medications: ['ibuprofen'],
      };

      const result = await workflow.execute(query, patientContext);

      expect(result).toBeDefined();
      expect(result.response).toBeDefined();
    });
  });
});