import { Tool } from '@langchain/core/tools';
import { supabase } from '../../supabase';
import { logger, logMedicalQuery } from '../../logger';
import { cacheManager } from '../../cache';

interface EmergencyParams {
  emergency: string;
  age?: string;
  weight?: number;
  symptoms?: string;
  vitals?: {
    hr?: number;
    bp?: string;
    rr?: number;
    temp?: number;
    spo2?: number;
  };
}

interface EmergencyProtocol {
  id: string;
  title: string;
  category: string;
  age_group: string;
  urgency_level: string;
  content: string;
  source: string;
  evidence_level: string;
  tags: string[];
}

export class EmergencyProtocolTool extends Tool {
  name = 'get_emergency_protocol';
  description = `Get pediatric emergency protocols and procedures. 
  Input should be JSON with: {"emergency": "condition or situation", "age": "patient_age", "weight": weight_in_kg, "symptoms": "presenting symptoms"}
  Returns step-by-step emergency management with Nelson Textbook citations.
  Example: {"emergency": "cardiac arrest", "age": "5 years", "weight": 20, "symptoms": "unresponsive, no pulse"}`;

  constructor() {
    super();
  }

  // Parse age to determine appropriate protocols
  private parseAgeGroup(ageString?: string): string {
    if (!ageString) return 'all';
    
    const ageStr = ageString.toLowerCase();
    
    if (ageStr.includes('day') || ageStr.includes('newborn') || ageStr.includes('neonat')) {
      return 'neonate';
    }
    if (ageStr.includes('week') || (ageStr.includes('month') && parseInt(ageStr) < 12)) {
      return 'infant';
    }
    if (ageStr.includes('year') && parseInt(ageStr) >= 1 && parseInt(ageStr) < 3) {
      return 'toddler';
    }
    if (ageStr.includes('year') && parseInt(ageStr) >= 3 && parseInt(ageStr) < 6) {
      return 'preschool';
    }
    if (ageStr.includes('year') && parseInt(ageStr) >= 6 && parseInt(ageStr) < 13) {
      return 'school_age';
    }
    if (ageStr.includes('year') && parseInt(ageStr) >= 13) {
      return 'adolescent';
    }
    
    return 'all';
  }

  // Search for emergency protocols
  private async searchEmergencyProtocols(
    emergency: string,
    ageGroup: string = 'all'
  ): Promise<EmergencyProtocol[]> {
    try {
      let query = supabase
        .from('pediatric_medical_resource')
        .select('*')
        .eq('resource_type', 'emergency_protocol')
        .or(`urgency_level.eq.high,urgency_level.eq.emergency`)
        .ilike('title', `%${emergency}%`);

      if (ageGroup !== 'all') {
        query = query.or(`age_group.eq.${ageGroup},age_group.eq.all`);
      }

      const { data, error } = await query
        .order('urgency_level', { ascending: false })
        .order('evidence_level', { ascending: true })
        .limit(3);

      if (error) {
        logger.error('Emergency protocol search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to search emergency protocols:', error);
      return [];
    }
  }

  // Get specific emergency protocols from predefined database
  private getBuiltInProtocols(emergency: string, params: EmergencyParams): string {
    const lowerEmergency = emergency.toLowerCase();
    
    if (lowerEmergency.includes('cardiac arrest') || lowerEmergency.includes('cpr')) {
      return this.getCardiacArrestProtocol(params);
    }
    
    if (lowerEmergency.includes('respiratory distress') || lowerEmergency.includes('asthma')) {
      return this.getRespiratoryDistressProtocol(params);
    }
    
    if (lowerEmergency.includes('anaphylaxis') || lowerEmergency.includes('allergic reaction')) {
      return this.getAnaphylaxisProtocol(params);
    }
    
    if (lowerEmergency.includes('seizure') || lowerEmergency.includes('convulsion')) {
      return this.getSeizureProtocol(params);
    }
    
    if (lowerEmergency.includes('shock') || lowerEmergency.includes('hypotension')) {
      return this.getShockProtocol(params);
    }
    
    if (lowerEmergency.includes('trauma') || lowerEmergency.includes('injury')) {
      return this.getTraumaProtocol(params);
    }
    
    return this.getGeneralEmergencyProtocol(params);
  }

  // Cardiac arrest protocol
  private getCardiacArrestProtocol(params: EmergencyParams): string {
    const ageGroup = this.parseAgeGroup(params.age);
    const weight = params.weight || 20; // Default if not provided
    
    let protocol = `**Pediatric Cardiac Arrest Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n\n`;
    
    protocol += `**Immediate Actions (First 2 minutes):**\n`;
    protocol += `1. **Verify arrest** - Check responsiveness and pulse\n`;
    protocol += `2. **Call for help** - Activate emergency response\n`;
    protocol += `3. **Position** - Supine on firm surface\n`;
    protocol += `4. **Airway** - Open airway (head-tilt, chin-lift)\n`;
    protocol += `5. **Begin CPR immediately**\n\n`;
    
    if (ageGroup === 'neonate' || ageGroup === 'infant') {
      protocol += `**CPR Technique (Infant <1 year):**\n`;
      protocol += `- Compression depth: 1/3 chest diameter (4cm)\n`;
      protocol += `- Rate: 100-120/min\n`;
      protocol += `- Ratio: 30:2 (single rescuer) or 15:2 (two rescuer)\n`;
      protocol += `- Hand position: Two fingers on lower sternum\n`;
    } else {
      protocol += `**CPR Technique (Child >1 year):**\n`;
      protocol += `- Compression depth: 1/3 chest diameter (5cm)\n`;
      protocol += `- Rate: 100-120/min\n`;
      protocol += `- Ratio: 30:2 (single rescuer) or 15:2 (two rescuer)\n`;
      protocol += `- Hand position: Heel of one hand on lower sternum\n`;
    }
    
    protocol += `\n**Medications:**\n`;
    protocol += `- **Epinephrine:** 0.01 mg/kg IV/IO (max 1mg)\n`;
    protocol += `  - Calculation: ${(0.01 * weight).toFixed(2)} mg\n`;
    protocol += `  - Give every 3-5 minutes\n`;
    protocol += `- **Amiodarone:** 5 mg/kg IV/IO for VF/VT\n`;
    protocol += `  - Calculation: ${(5 * weight).toFixed(1)} mg\n\n`;
    
    protocol += `**Advanced Management:**\n`;
    protocol += `- Secure airway (ET tube, LMA)\n`;
    protocol += `- Continuous chest compressions once airway secured\n`;
    protocol += `- Vascular access (IV/IO)\n`;
    protocol += `- Identify and treat reversible causes\n\n`;
    
    protocol += `**Reversible Causes (4 H's and 4 T's):**\n`;
    protocol += `- Hypoxia, Hypovolemia, Hypothermia, Hyper/hypokalemia\n`;
    protocol += `- Tension pneumothorax, Tamponade, Toxins, Thrombosis\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 567-575 (Cardiopulmonary Resuscitation)\n`;
    protocol += `- Nelson, pg. 2956-2965 (Emergency Medicine)\n`;
    protocol += `- 2020 AHA Pediatric Life Support Guidelines\n\n`;
    
    return protocol;
  }

  // Respiratory distress protocol
  private getRespiratoryDistressProtocol(params: EmergencyParams): string {
    const weight = params.weight || 20;
    
    let protocol = `**Pediatric Respiratory Distress Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n`;
    protocol += `**Symptoms:** ${params.symptoms || 'Not specified'}\n\n`;
    
    protocol += `**Initial Assessment:**\n`;
    protocol += `1. **Airway** - Check patency, position\n`;
    protocol += `2. **Breathing** - Rate, effort, symmetry, oxygen saturation\n`;
    protocol += `3. **Circulation** - Heart rate, blood pressure, perfusion\n`;
    protocol += `4. **Disability** - Neurological status\n\n`;
    
    protocol += `**Immediate Management:**\n`;
    protocol += `1. **Oxygen** - High-flow O₂ via non-rebreather mask\n`;
    protocol += `2. **Position** - Upright, position of comfort\n`;
    protocol += `3. **Monitor** - Continuous pulse oximetry, cardiac monitor\n`;
    protocol += `4. **IV access** - Obtain if stable\n\n`;
    
    protocol += `**Medications for Asthma/Bronchospasm:**\n`;
    protocol += `- **Albuterol:** 2.5-5mg nebulized every 20 minutes\n`;
    protocol += `- **Prednisolone:** 1-2 mg/kg PO (max 60mg)\n`;
    protocol += `  - Calculation: ${(1.5 * weight).toFixed(1)} mg\n`;
    protocol += `- **Epinephrine:** 0.01 mg/kg IM for severe bronchospasm\n`;
    protocol += `  - Calculation: ${(0.01 * weight).toFixed(2)} mg\n\n`;
    
    protocol += `**Severe Distress Interventions:**\n`;
    protocol += `- Consider magnesium sulfate: 25-50 mg/kg IV\n`;
    protocol += `- Prepare for intubation if worsening\n`;
    protocol += `- CPAP/BiPAP if available and appropriate\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 2095-2110 (Asthma)\n`;
    protocol += `- Nelson, pg. 567-575 (Respiratory Emergencies)\n\n`;
    
    return protocol;
  }

  // Anaphylaxis protocol
  private getAnaphylaxisProtocol(params: EmergencyParams): string {
    const weight = params.weight || 20;
    
    let protocol = `**Pediatric Anaphylaxis Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n\n`;
    
    protocol += `**Immediate Actions:**\n`;
    protocol += `1. **Remove trigger** if identifiable\n`;
    protocol += `2. **Assess airway** - Swelling, stridor\n`;
    protocol += `3. **Position** - Supine with legs elevated\n`;
    protocol += `4. **Epinephrine immediately** - First-line treatment\n\n`;
    
    protocol += `**Epinephrine Dosing:**\n`;
    protocol += `- **Dose:** 0.01 mg/kg IM (1:1000) into lateral thigh\n`;
    protocol += `  - Calculation: ${(0.01 * weight).toFixed(2)} mg\n`;
    protocol += `  - Maximum dose: 0.5 mg\n`;
    protocol += `- **EpiPen Jr (<30kg):** 0.15 mg\n`;
    protocol += `- **EpiPen (>30kg):** 0.3 mg\n`;
    protocol += `- **Repeat** in 5-15 minutes if no improvement\n\n`;
    
    protocol += `**Secondary Medications:**\n`;
    protocol += `- **H1 antihistamine (Diphenhydramine):** 1-2 mg/kg IV/IM\n`;
    protocol += `  - Calculation: ${(1.5 * weight).toFixed(1)} mg\n`;
    protocol += `- **H2 antihistamine (Ranitidine):** 1 mg/kg IV\n`;
    protocol += `  - Calculation: ${weight} mg\n`;
    protocol += `- **Corticosteroids (Prednisolone):** 1-2 mg/kg PO/IV\n`;
    protocol += `  - Calculation: ${(1.5 * weight).toFixed(1)} mg\n\n`;
    
    protocol += `**Fluid Resuscitation:**\n`;
    protocol += `- Normal saline: 20 ml/kg IV bolus\n`;
    protocol += `  - Calculation: ${(20 * weight)} ml\n`;
    protocol += `- Repeat if signs of shock persist\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 1145-1150 (Anaphylaxis)\n`;
    protocol += `- Nelson, pg. 1135-1145 (Allergic Reactions)\n\n`;
    
    return protocol;
  }

  // Seizure protocol
  private getSeizureProtocol(params: EmergencyParams): string {
    const weight = params.weight || 20;
    
    let protocol = `**Pediatric Seizure Management Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n\n`;
    
    protocol += `**Initial Management:**\n`;
    protocol += `1. **Ensure safety** - Remove hazards, position on side\n`;
    protocol += `2. **Assess airway** - Maintain patency, suction if needed\n`;
    protocol += `3. **Oxygen** - Apply high-flow O₂\n`;
    protocol += `4. **IV access** - Establish if seizure continues\n`;
    protocol += `5. **Check glucose** - Point-of-care testing\n\n`;
    
    protocol += `**Anticonvulsant Medications:**\n`;
    
    protocol += `**First-line (Active seizure >5 minutes):**\n`;
    protocol += `- **Lorazepam:** 0.1 mg/kg IV/IO (max 4mg)\n`;
    protocol += `  - Calculation: ${(0.1 * weight).toFixed(1)} mg\n`;
    protocol += `- **Midazolam:** 0.2 mg/kg IM if no IV access\n`;
    protocol += `  - Calculation: ${(0.2 * weight).toFixed(1)} mg\n\n`;
    
    protocol += `**Second-line (if seizure continues):**\n`;
    protocol += `- **Phenytoin:** 20 mg/kg IV over 20 minutes\n`;
    protocol += `  - Calculation: ${(20 * weight)} mg\n`;
    protocol += `- **Levetiracetam:** 20-40 mg/kg IV\n`;
    protocol += `  - Calculation: ${(30 * weight)} mg\n\n`;
    
    protocol += `**Status Epilepticus (>30 minutes):**\n`;
    protocol += `- Consider continuous infusion\n`;
    protocol += `- Prepare for intubation\n`;
    protocol += `- ICU consultation\n\n`;
    
    protocol += `**Supportive Care:**\n`;
    protocol += `- Dextrose if hypoglycemic: 0.5-1 g/kg IV\n`;
    protocol += `- Temperature control if febrile\n`;
    protocol += `- Protect from injury\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 2823-2845 (Seizures and Epilepsy)\n`;
    protocol += `- Nelson, pg. 2956-2965 (Emergency Medicine)\n\n`;
    
    return protocol;
  }

  // Shock protocol
  private getShockProtocol(params: EmergencyParams): string {
    const weight = params.weight || 20;
    
    let protocol = `**Pediatric Shock Management Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n\n`;
    
    protocol += `**Initial Assessment:**\n`;
    protocol += `1. **Recognize shock** - Altered mental status, poor perfusion\n`;
    protocol += `2. **Identify type** - Hypovolemic, distributive, cardiogenic\n`;
    protocol += `3. **Secure airway** - High-flow oxygen\n`;
    protocol += `4. **Vascular access** - Large bore IV/IO\n\n`;
    
    protocol += `**Fluid Resuscitation:**\n`;
    protocol += `- **Initial bolus:** 20 ml/kg normal saline IV/IO\n`;
    protocol += `  - Calculation: ${(20 * weight)} ml over 5-10 minutes\n`;
    protocol += `- **Repeat** up to 60 ml/kg total if hypovolemic\n`;
    protocol += `- **Reassess** after each bolus\n\n`;
    
    protocol += `**Vasoactive Medications:**\n`;
    protocol += `**If fluid-refractory shock:**\n`;
    protocol += `- **Epinephrine:** 0.1-1 mcg/kg/min IV infusion\n`;
    protocol += `- **Norepinephrine:** 0.1-2 mcg/kg/min IV infusion\n`;
    protocol += `- **Dopamine:** 5-20 mcg/kg/min IV infusion\n\n`;
    
    protocol += `**Monitoring:**\n`;
    protocol += `- Heart rate, blood pressure\n`;
    protocol += `- Capillary refill, mental status\n`;
    protocol += `- Urine output (goal >1 ml/kg/hr)\n`;
    protocol += `- Lactate levels\n\n`;
    
    protocol += `**Additional Considerations:**\n`;
    protocol += `- Antibiotics if septic shock suspected\n`;
    protocol += `- Hydrocortisone if adrenal insufficiency\n`;
    protocol += `- ECMO consideration for refractory shock\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 439-445 (Shock)\n`;
    protocol += `- Nelson, pg. 1315-1325 (Sepsis)\n\n`;
    
    return protocol;
  }

  // Trauma protocol
  private getTraumaProtocol(params: EmergencyParams): string {
    const weight = params.weight || 20;
    
    let protocol = `**Pediatric Trauma Protocol**\n\n`;
    
    protocol += `**Patient:** ${params.age || 'Age not specified'}, ${weight}kg\n\n`;
    
    protocol += `**Primary Survey (ABCDE):**\n`;
    protocol += `**A - Airway** with C-spine protection\n`;
    protocol += `- Immobilize cervical spine\n`;
    protocol += `- Assess airway patency\n`;
    protocol += `- Consider intubation if compromised\n\n`;
    
    protocol += `**B - Breathing**\n`;
    protocol += `- Assess respiratory effort and air entry\n`;
    protocol += `- High-flow oxygen\n`;
    protocol += `- Chest decompression if tension pneumothorax\n\n`;
    
    protocol += `**C - Circulation**\n`;
    protocol += `- Control external bleeding\n`;
    protocol += `- Assess perfusion and blood pressure\n`;
    protocol += `- Establish IV/IO access\n\n`;
    
    protocol += `**Fluid Resuscitation:**\n`;
    protocol += `- **Crystalloid:** 20 ml/kg normal saline bolus\n`;
    protocol += `  - Calculation: ${(20 * weight)} ml\n`;
    protocol += `- **Blood products** if ongoing blood loss\n`;
    protocol += `- Avoid over-resuscitation\n\n`;
    
    protocol += `**D - Disability/Neurological**\n`;
    protocol += `- GCS assessment\n`;
    protocol += `- Pupil examination\n`;
    protocol += `- Blood glucose check\n\n`;
    
    protocol += `**E - Exposure/Environment**\n`;
    protocol += `- Full body examination\n`;
    protocol += `- Prevent hypothermia\n`;
    protocol += `- Log roll with C-spine protection\n\n`;
    
    protocol += `**Critical Actions:**\n`;
    protocol += `- Activate trauma team\n`;
    protocol += `- Surgical consultation if indicated\n`;
    protocol += `- Blood bank notification\n`;
    protocol += `- Family notification and support\n\n`;
    
    protocol += `**References:**\n`;
    protocol += `- Nelson, pg. 459-475 (Trauma)\n`;
    protocol += `- Nelson, pg. 2956-2965 (Emergency Medicine)\n\n`;
    
    return protocol;
  }

  // General emergency protocol
  private getGeneralEmergencyProtocol(params: EmergencyParams): string {
    return `**General Pediatric Emergency Assessment**\n\n` +
           `**Patient:** ${params.age || 'Age not specified'}\n\n` +
           `**Initial Assessment (PAT - Pediatric Assessment Triangle):**\n` +
           `1. **Appearance** - TICLS (Tone, Interactiveness, Consolability, Look, Speech)\n` +
           `2. **Work of breathing** - Rate, effort, audible sounds\n` +
           `3. **Circulation** - Skin color, perfusion\n\n` +
           `**Primary Survey (ABCDE):**\n` +
           `- **Airway** - Patency and protection\n` +
           `- **Breathing** - Ventilation and oxygenation\n` +
           `- **Circulation** - Perfusion and hemorrhage control\n` +
           `- **Disability** - Neurological function\n` +
           `- **Exposure** - Complete examination\n\n` +
           `**General Management:**\n` +
           `- Ensure patient safety\n` +
           `- Obtain appropriate history\n` +
           `- Continuous monitoring\n` +
           `- Prepare for specific interventions\n\n` +
           `**References:**\n` +
           `- Nelson, pg. 2956-2965 (Emergency Medicine)\n` +
           `- Nelson, pg. 350-365 (Pediatric Assessment)\n\n`;
  }

  // Check cache for protocols
  private async getCachedProtocol(key: string): Promise<string | null> {
    return await cacheManager.get('emergency', key);
  }

  // Cache protocol results
  private async cacheProtocol(key: string, protocol: string): Promise<void> {
    await cacheManager.set('emergency', key, protocol, 60 * 60); // 1 hour
  }

  // Main function
  async _call(input: string): Promise<string> {
    try {
      // Parse input
      let params: EmergencyParams;
      try {
        params = JSON.parse(input);
      } catch (error) {
        return 'Error: Input must be valid JSON with emergency type. Example: {"emergency": "cardiac arrest", "age": "5 years", "weight": 20}';
      }

      if (!params.emergency) {
        return 'Error: emergency field is required.';
      }

      logger.info('Emergency protocol request', {
        emergency: params.emergency,
        age: params.age,
        weight: params.weight,
      });

      // Check cache
      const cacheKey = `${params.emergency}_${params.age}_${params.weight}`;
      const cachedProtocol = await this.getCachedProtocol(cacheKey);
      if (cachedProtocol) {
        logger.debug('Using cached emergency protocol');
        return cachedProtocol;
      }

      // Search database for protocols
      const ageGroup = this.parseAgeGroup(params.age);
      const dbProtocols = await this.searchEmergencyProtocols(params.emergency, ageGroup);

      let protocol: string;

      if (dbProtocols.length > 0) {
        // Use database protocols if available
        protocol = this.formatDatabaseProtocols(dbProtocols, params);
      } else {
        // Use built-in protocols
        protocol = this.getBuiltInProtocols(params.emergency, params);
      }

      // Add emergency footer
      protocol += `\n**⚠️ EMERGENCY DISCLAIMER:**\n`;
      protocol += `This protocol is for reference only. Always follow your institution's specific `;
      protocol += `emergency protocols and guidelines. Call for senior/specialist help early. `;
      protocol += `Consider patient-specific factors and comorbidities.`;

      // Cache the result
      await this.cacheProtocol(cacheKey, protocol);

      // Log the protocol request
      logMedicalQuery(
        `Emergency protocol: ${params.emergency}`,
        undefined,
        Date.now()
      );

      return protocol;

    } catch (error) {
      logger.error('Emergency protocol generation failed:', error);
      return `Error generating emergency protocol: ${error.message}. Please check your input and try again, or consult immediate emergency resources.`;
    }
  }

  // Format database protocols
  private formatDatabaseProtocols(protocols: EmergencyProtocol[], params: EmergencyParams): string {
    let result = `**${protocols[0].title}**\n\n`;
    result += `**Patient:** ${params.age || 'Age not specified'}\n`;
    if (params.weight) result += `**Weight:** ${params.weight} kg\n`;
    if (params.symptoms) result += `**Symptoms:** ${params.symptoms}\n`;
    result += `\n`;

    protocols.forEach((protocol, index) => {
      if (index > 0) result += `\n---\n\n`;
      result += `**${protocol.title}** (${protocol.category})\n`;
      result += `**Urgency Level:** ${protocol.urgency_level}\n`;
      result += `**Evidence Level:** ${protocol.evidence_level}\n\n`;
      result += protocol.content;
      if (protocol.source) {
        result += `\n\n**Source:** ${protocol.source}\n`;
      }
    });

    return result;
  }
}