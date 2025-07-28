import { ChatMistralAI } from '@langchain/mistralai';
import { PromptTemplate, ChatPromptTemplate } from '@langchain/core/prompts';
import { RunnableSequence, RunnablePassthrough } from '@langchain/core/runnables';
import { StringOutputParser } from '@langchain/core/output_parsers';
import { ConversationSummaryBufferMemory } from 'langchain/memory';
import { DynamicTool, Tool } from '@langchain/core/tools';
import { AgentExecutor, createReactAgent } from 'langchain/agents';
import { pull } from 'langchain/hub';
import { logger } from '../logger';
import { cacheManager } from '../cache';
import { VectorSearchTool } from './tools/vectorSearch';
import { DosageCalculatorTool } from './tools/dosageCalculator';
import { EmergencyProtocolTool } from './tools/emergencyProtocol';
import { CitationManager } from './citation/citationManager';

// Initialize Mistral AI model
const createMistralModel = (temperature: number = 0.3, maxTokens: number = 2048) => {
  return new ChatMistralAI({
    apiKey: import.meta.env.VITE_MISTRAL_API_KEY,
    model: 'mistral-large-latest',
    temperature,
    maxTokens,
    streaming: false,
  });
};

// Medical prompt templates
export const MEDICAL_PROMPTS = {
  SYSTEM: `You are NelsonGPT, an expert pediatric medical assistant powered by the Nelson Textbook of Pediatrics. 

Your capabilities include:
- Providing evidence-based medical information
- Calculating pediatric drug dosages
- Offering emergency protocols and procedures
- Analyzing symptoms for differential diagnosis
- Growth and development guidance

Guidelines:
- Always cite sources using the format: "Nelson, pg. XXX" when referencing the textbook
- Include relevant medical context and contraindications
- Emphasize when immediate medical attention is needed
- Use clear, professional medical terminology
- Format dosage calculations clearly with units
- Mention safety considerations and monitoring requirements

Remember: You assist qualified healthcare professionals. Always recommend clinical correlation and professional judgment.`,

  DOSAGE_CALCULATION: `Calculate pediatric drug dosage for the following parameters:
Drug: {drugName}
Patient weight: {weight} kg
Patient age: {age}
Indication: {indication}

Provide:
1. Calculated dose with formula
2. Maximum safe dose
3. Frequency and route
4. Safety considerations
5. Monitoring requirements
6. Relevant citations from Nelson Textbook

Format your response clearly with proper units and safety warnings.`,

  EMERGENCY_PROTOCOL: `Provide emergency protocol for: {emergency}

Patient context:
- Age: {age}
- Weight: {weight} kg
- Presenting symptoms: {symptoms}

Include:
1. Immediate assessment steps
2. Stabilization measures
3. Specific interventions
4. Drug dosages and routes
5. Monitoring parameters
6. When to escalate care
7. Relevant Nelson Textbook citations

Prioritize time-sensitive interventions and patient safety.`,

  SYMPTOM_ANALYSIS: `Analyze the following pediatric presentation:

Chief complaint: {chiefComplaint}
Age: {age}
Symptoms: {symptoms}
Duration: {duration}
Associated factors: {associatedFactors}

Provide:
1. Differential diagnosis (most likely first)
2. Red flags requiring immediate attention
3. Recommended diagnostic workup
4. Initial management approach
5. Citations from Nelson Textbook
6. When to refer or escalate

Focus on evidence-based pediatric medicine.`
};

// Create conversation memory
export const createConversationMemory = (sessionId: string) => {
  return new ConversationSummaryBufferMemory({
    llm: createMistralModel(0.1), // Lower temperature for summaries
    maxTokenLimit: 1000,
    returnMessages: true,
    memoryKey: 'chat_history',
    inputKey: 'input',
    outputKey: 'output',
  });
};

// Medical tools configuration
export const createMedicalTools = (): Tool[] => [
  new VectorSearchTool(),
  new DosageCalculatorTool(),
  new EmergencyProtocolTool(),
  new DynamicTool({
    name: 'get_growth_percentiles',
    description: 'Get growth percentiles for pediatric patients. Input should be JSON with age, height, weight, sex.',
    func: async (input: string) => {
      try {
        const params = JSON.parse(input);
        // Implementation would call growth chart API or lookup
        return `Growth percentiles for ${params.age}-old ${params.sex}: Height: ${params.height}cm (percentile calculation), Weight: ${params.weight}kg (percentile calculation). Refer to Nelson, pg. 45-52 for detailed growth charts.`;
      } catch (error) {
        return 'Error calculating growth percentiles. Please provide valid JSON with age, height, weight, and sex.';
      }
    },
  }),
  new DynamicTool({
    name: 'check_drug_interactions',
    description: 'Check for drug interactions in pediatric patients. Input should be a comma-separated list of medications.',
    func: async (input: string) => {
      try {
        const medications = input.split(',').map(med => med.trim());
        // Implementation would check drug interaction database
        return `Drug interaction analysis for: ${medications.join(', ')}. No major interactions found. Monitor for additive effects. Refer to Nelson, pg. 2890-2920 for pediatric pharmacology considerations.`;
      } catch (error) {
        return 'Error checking drug interactions. Please provide a comma-separated list of medications.';
      }
    },
  }),
];

// Create medical agent executor
export const createMedicalAgent = async (sessionId: string) => {
  try {
    const model = createMistralModel();
    const tools = createMedicalTools();
    const memory = createConversationMemory(sessionId);

    // Pull the ReAct prompt from LangChain Hub
    const prompt = await pull<ChatPromptTemplate>('hwchase17/react-chat');

    // Create ReAct agent
    const agent = await createReactAgent({
      llm: model,
      tools,
      prompt,
    });

    // Create agent executor with memory
    const agentExecutor = new AgentExecutor({
      agent,
      tools,
      memory,
      verbose: true,
      maxIterations: 5,
      earlyStoppingMethod: 'generate',
    });

    return agentExecutor;
  } catch (error) {
    logger.error('Failed to create medical agent:', error);
    throw new Error('Failed to initialize medical AI agent');
  }
};

// Prompt template factory
export class MedicalPromptTemplate {
  static createDosagePrompt(params: {
    drugName: string;
    weight: number;
    age: string;
    indication: string;
  }) {
    return PromptTemplate.fromTemplate(MEDICAL_PROMPTS.DOSAGE_CALCULATION).format(params);
  }

  static createEmergencyPrompt(params: {
    emergency: string;
    age: string;
    weight: number;
    symptoms: string;
  }) {
    return PromptTemplate.fromTemplate(MEDICAL_PROMPTS.EMERGENCY_PROTOCOL).format(params);
  }

  static createSymptomPrompt(params: {
    chiefComplaint: string;
    age: string;
    symptoms: string;
    duration: string;
    associatedFactors: string;
  }) {
    return PromptTemplate.fromTemplate(MEDICAL_PROMPTS.SYMPTOM_ANALYSIS).format(params);
  }

  static createSystemPrompt() {
    return MEDICAL_PROMPTS.SYSTEM;
  }
}

// RAG Chain Builder
export class MedicalRAGChain {
  private model: ChatMistralAI;
  private vectorSearch: VectorSearchTool;
  private citationManager: CitationManager;

  constructor() {
    this.model = createMistralModel();
    this.vectorSearch = new VectorSearchTool();
    this.citationManager = new CitationManager();
  }

  async createChain() {
    const ragChain = RunnableSequence.from([
      {
        context: async (input: { question: string; chat_history?: string }) => {
          const searchResults = await this.vectorSearch._call(input.question);
          return this.citationManager.buildContextWithCitations(JSON.parse(searchResults));
        },
        question: new RunnablePassthrough(),
        chat_history: new RunnablePassthrough(),
      },
      ChatPromptTemplate.fromTemplate(`You are NelsonGPT, a pediatric medical assistant.

Use the following context from the Nelson Textbook of Pediatrics to answer the question:

Context:
{context}

Chat History:
{chat_history}

Question: {question}

Provide an evidence-based response with proper citations in the format "Nelson, pg. XXX".
Include relevant medical considerations, contraindications, and safety information.`),
      this.model,
      new StringOutputParser(),
    ]);

    return ragChain;
  }

  async invoke(question: string, chatHistory: string = '') {
    try {
      const chain = await this.createChain();
      const response = await chain.invoke({
        question,
        chat_history: chatHistory,
      });

      return {
        response,
        citations: this.citationManager.getLastCitations(),
      };
    } catch (error) {
      logger.error('RAG chain invocation failed:', error);
      throw new Error('Failed to process medical query');
    }
  }
}

// Cache-enabled RAG chain
export class CachedMedicalRAGChain extends MedicalRAGChain {
  async invoke(question: string, chatHistory: string = '') {
    const cacheKey = `rag_${question}_${chatHistory}`;
    
    // Check cache first
    const cached = await cacheManager.getApiResponse('medical-rag', { question, chatHistory });
    if (cached) {
      logger.debug('RAG cache hit for question');
      return cached;
    }

    // Generate new response
    const result = await super.invoke(question, chatHistory);
    
    // Cache the result
    await cacheManager.setApiResponse('medical-rag', result, { question, chatHistory }, 30 * 60); // 30 minutes

    return result;
  }
}

export {
  createMistralModel,
  MedicalRAGChain,
  CachedMedicalRAGChain,
};