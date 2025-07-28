import { Tool } from '@langchain/core/tools';
import { supabase } from '../../supabase';
import { logger, logMedicalQuery } from '../../logger';
import { checkDosageCalculationLimit } from '../../rateLimit';
import { MedicalDataError } from '../../components/ErrorBoundary';

interface DosageParams {
  drugName: string;
  weight: number;
  age?: string;
  indication?: string;
  route?: string;
}

interface DrugInfo {
  id: string;
  drug_name: string;
  generic_name?: string;
  indication: string;
  route: string;
  dose_per_kg?: number;
  dose_per_m2?: number;
  max_dose?: number;
  min_age_months?: number;
  max_age_months?: number;
  frequency: string;
  contraindications?: string[];
  side_effects?: string[];
  monitoring_requirements?: string[];
  pregnancy_category?: string;
  lactation_safety?: string;
}

export class DosageCalculatorTool extends Tool {
  name = 'calculate_pediatric_dosage';
  description = `Calculate pediatric drug dosages with safety checks. 
  Input should be JSON with: {"drugName": "medication name", "weight": weight_in_kg, "age": "patient_age", "indication": "condition", "route": "administration_route"}
  Returns calculated dose, safety information, and Nelson Textbook citations.
  Example: {"drugName": "amoxicillin", "weight": 15, "age": "3 years", "indication": "otitis media", "route": "oral"}`;

  constructor() {
    super();
  }

  // Parse age string to months
  private parseAgeToMonths(ageString: string): number | null {
    if (!ageString) return null;
    
    const ageStr = ageString.toLowerCase().trim();
    
    // Extract number and unit
    const yearMatch = ageStr.match(/(\d+\.?\d*)\s*(?:years?|yrs?|y)/);
    const monthMatch = ageStr.match(/(\d+\.?\d*)\s*(?:months?|mos?|m)/);
    const weekMatch = ageStr.match(/(\d+\.?\d*)\s*(?:weeks?|wks?|w)/);
    const dayMatch = ageStr.match(/(\d+\.?\d*)\s*(?:days?|d)/);

    if (yearMatch) {
      return Math.round(parseFloat(yearMatch[1]) * 12);
    } else if (monthMatch) {
      return Math.round(parseFloat(monthMatch[1]));
    } else if (weekMatch) {
      return Math.round(parseFloat(weekMatch[1]) / 4.33);
    } else if (dayMatch) {
      return Math.round(parseFloat(dayMatch[1]) / 30.44);
    }

    return null;
  }

  // Calculate body surface area (BSA) using Mosteller formula
  private calculateBSA(weightKg: number, heightCm?: number): number {
    if (!heightCm) {
      // Estimate height based on age for BSA calculation if not provided
      // This is an approximation - actual height should be used when available
      const estimatedHeight = this.estimateHeightFromWeight(weightKg);
      heightCm = estimatedHeight;
    }
    
    return Math.sqrt((weightKg * heightCm) / 3600);
  }

  // Estimate height from weight (rough approximation for BSA)
  private estimateHeightFromWeight(weightKg: number): number {
    // Very rough estimation - should use actual height when available
    // Based on average pediatric growth patterns
    if (weightKg < 3) return 50; // Newborn
    if (weightKg < 5) return 60; // 0-3 months
    if (weightKg < 7) return 70; // 3-6 months
    if (weightKg < 10) return 80; // 6-12 months
    if (weightKg < 15) return 90; // 1-2 years
    if (weightKg < 20) return 100; // 2-4 years
    if (weightKg < 30) return 120; // 4-8 years
    if (weightKg < 40) return 140; // 8-12 years
    return 160; // 12+ years
  }

  // Search for drug information in database
  private async searchDrugInfo(drugName: string, indication?: string, route?: string): Promise<DrugInfo[]> {
    try {
      let query = supabase
        .from('pediatric_drug_dosages')
        .select('*')
        .ilike('drug_name', `%${drugName}%`);

      if (indication) {
        query = query.ilike('indication', `%${indication}%`);
      }

      if (route) {
        query = query.eq('route', route.toLowerCase());
      }

      const { data, error } = await query.limit(5);

      if (error) {
        logger.error('Drug search error:', error);
        return [];
      }

      return data || [];
    } catch (error) {
      logger.error('Failed to search drug information:', error);
      return [];
    }
  }

  // Validate dosage safety
  private validateDosage(drugInfo: DrugInfo, params: DosageParams): {
    isValid: boolean;
    warnings: string[];
    errors: string[];
  } {
    const warnings: string[] = [];
    const errors: string[] = [];
    let isValid = true;

    const ageInMonths = params.age ? this.parseAgeToMonths(params.age) : null;

    // Check age restrictions
    if (ageInMonths !== null && drugInfo.min_age_months && ageInMonths < drugInfo.min_age_months) {
      errors.push(`Patient age (${params.age}) is below minimum recommended age for ${drugInfo.drug_name}`);
      isValid = false;
    }

    if (ageInMonths !== null && drugInfo.max_age_months && ageInMonths > drugInfo.max_age_months) {
      errors.push(`Patient age (${params.age}) is above maximum recommended age for ${drugInfo.drug_name}`);
      isValid = false;
    }

    // Check weight-based dosing limits
    if (drugInfo.dose_per_kg && params.weight) {
      const calculatedDose = drugInfo.dose_per_kg * params.weight;
      if (drugInfo.max_dose && calculatedDose > drugInfo.max_dose) {
        warnings.push(`Calculated dose (${calculatedDose.toFixed(1)} mg) exceeds maximum dose (${drugInfo.max_dose} mg)`);
      }
    }

    // Check for contraindications (would need patient-specific data)
    if (drugInfo.contraindications && drugInfo.contraindications.length > 0) {
      warnings.push(`Check for contraindications: ${drugInfo.contraindications.join(', ')}`);
    }

    return { isValid, warnings, errors };
  }

  // Calculate final dosage
  private calculateDosage(drugInfo: DrugInfo, params: DosageParams): any {
    const results: any = {
      drug_name: drugInfo.drug_name,
      generic_name: drugInfo.generic_name,
      indication: drugInfo.indication,
      route: drugInfo.route,
      frequency: drugInfo.frequency,
    };

    // Weight-based dosing
    if (drugInfo.dose_per_kg && params.weight) {
      const weightBasedDose = drugInfo.dose_per_kg * params.weight;
      results.weight_based_dose = {
        calculation: `${drugInfo.dose_per_kg} mg/kg × ${params.weight} kg = ${weightBasedDose.toFixed(1)} mg`,
        dose_mg: weightBasedDose,
        per_dose: drugInfo.max_dose ? Math.min(weightBasedDose, drugInfo.max_dose) : weightBasedDose,
      };
    }

    // BSA-based dosing (if applicable)
    if (drugInfo.dose_per_m2 && params.weight) {
      const bsa = this.calculateBSA(params.weight);
      const bsaBasedDose = drugInfo.dose_per_m2 * bsa;
      results.bsa_based_dose = {
        calculation: `${drugInfo.dose_per_m2} mg/m² × ${bsa.toFixed(2)} m² = ${bsaBasedDose.toFixed(1)} mg`,
        bsa_m2: bsa,
        dose_mg: bsaBasedDose,
        per_dose: drugInfo.max_dose ? Math.min(bsaBasedDose, drugInfo.max_dose) : bsaBasedDose,
      };
    }

    // Final recommended dose
    let recommendedDose = 0;
    let doseMethod = '';

    if (results.weight_based_dose) {
      recommendedDose = results.weight_based_dose.per_dose;
      doseMethod = 'weight-based';
    } else if (results.bsa_based_dose) {
      recommendedDose = results.bsa_based_dose.per_dose;
      doseMethod = 'BSA-based';
    }

    results.recommended_dose = {
      dose_mg: recommendedDose,
      method: doseMethod,
      frequency: drugInfo.frequency,
      route: drugInfo.route,
      max_dose: drugInfo.max_dose,
    };

    return results;
  }

  // Format dosage calculation result
  private formatDosageResult(
    params: DosageParams,
    drugInfo: DrugInfo,
    calculation: any,
    validation: any
  ): string {
    let result = `**Pediatric Dosage Calculation for ${drugInfo.drug_name}**\n\n`;

    // Patient information
    result += `**Patient Information:**\n`;
    result += `- Weight: ${params.weight} kg\n`;
    if (params.age) result += `- Age: ${params.age}\n`;
    result += `- Indication: ${drugInfo.indication}\n`;
    result += `- Route: ${drugInfo.route}\n\n`;

    // Dosage calculation
    result += `**Dosage Calculation:**\n`;
    
    if (calculation.weight_based_dose) {
      result += `- Weight-based: ${calculation.weight_based_dose.calculation}\n`;
    }
    
    if (calculation.bsa_based_dose) {
      result += `- BSA-based: ${calculation.bsa_based_dose.calculation}\n`;
      result += `- BSA: ${calculation.bsa_based_dose.bsa_m2} m²\n`;
    }

    result += `\n**Recommended Dose:**\n`;
    result += `- **${calculation.recommended_dose.dose_mg.toFixed(1)} mg ${calculation.recommended_dose.frequency}**\n`;
    result += `- Method: ${calculation.recommended_dose.method}\n`;
    result += `- Route: ${calculation.recommended_dose.route}\n`;
    
    if (calculation.recommended_dose.max_dose) {
      result += `- Maximum dose: ${calculation.recommended_dose.max_dose} mg\n`;
    }

    // Safety information
    if (validation.errors.length > 0) {
      result += `\n**⚠️ ERRORS:**\n`;
      validation.errors.forEach((error: string) => {
        result += `- ${error}\n`;
      });
    }

    if (validation.warnings.length > 0) {
      result += `\n**⚠️ WARNINGS:**\n`;
      validation.warnings.forEach((warning: string) => {
        result += `- ${warning}\n`;
      });
    }

    // Additional safety information
    if (drugInfo.contraindications && drugInfo.contraindications.length > 0) {
      result += `\n**Contraindications:**\n- ${drugInfo.contraindications.join('\n- ')}\n`;
    }

    if (drugInfo.side_effects && drugInfo.side_effects.length > 0) {
      result += `\n**Common Side Effects:**\n- ${drugInfo.side_effects.slice(0, 5).join('\n- ')}\n`;
    }

    if (drugInfo.monitoring_requirements && drugInfo.monitoring_requirements.length > 0) {
      result += `\n**Monitoring Requirements:**\n- ${drugInfo.monitoring_requirements.join('\n- ')}\n`;
    }

    // Citation
    result += `\n**References:**\n`;
    result += `- Nelson Textbook of Pediatrics, Drug Dosing Guidelines\n`;
    result += `- Pediatric pharmacology considerations (Nelson, pg. 2890-2920)\n`;

    // Medical disclaimer
    result += `\n**⚠️ Medical Disclaimer:**\n`;
    result += `This calculation is for reference only. Always verify dosing with current guidelines, `;
    result += `consider patient-specific factors, and consult clinical pharmacology resources. `;
    result += `Monitor for therapeutic response and adverse effects.`;

    return result;
  }

  // Main calculation function
  async _call(input: string): Promise<string> {
    try {
      // Check rate limit
      const canProceed = await checkDosageCalculationLimit();
      if (!canProceed) {
        throw new MedicalDataError('Rate limit exceeded for dosage calculations', 'calculation');
      }

      // Parse input
      let params: DosageParams;
      try {
        params = JSON.parse(input);
      } catch (error) {
        return 'Error: Input must be valid JSON with drugName, weight, and optional age, indication, route. Example: {"drugName": "amoxicillin", "weight": 15, "age": "3 years", "indication": "otitis media"}';
      }

      // Validate required parameters
      if (!params.drugName || !params.weight) {
        return 'Error: drugName and weight are required parameters.';
      }

      if (params.weight <= 0 || params.weight > 200) {
        return 'Error: Weight must be between 0 and 200 kg.';
      }

      logger.info('Dosage calculation initiated', {
        drug_name: params.drugName,
        weight: params.weight,
        age: params.age,
        indication: params.indication,
      });

      // Search for drug information
      const drugInfoList = await this.searchDrugInfo(
        params.drugName,
        params.indication,
        params.route
      );

      if (drugInfoList.length === 0) {
        return `No dosing information found for "${params.drugName}" in the pediatric database. Please verify the drug name or consult additional resources. Common pediatric dosing references can be found in Nelson, pg. 2890-2920.`;
      }

      // Use the best match (first result)
      const drugInfo = drugInfoList[0];

      // Validate dosage safety
      const validation = this.validateDosage(drugInfo, params);

      if (!validation.isValid) {
        let errorResult = `**Dosage Calculation Error for ${params.drugName}**\n\n`;
        errorResult += `**Errors:**\n`;
        validation.errors.forEach(error => {
          errorResult += `- ${error}\n`;
        });
        errorResult += `\nPlease review patient parameters and consult additional resources.`;
        return errorResult;
      }

      // Calculate dosage
      const calculation = this.calculateDosage(drugInfo, params);

      // Format result
      const formattedResult = this.formatDosageResult(params, drugInfo, calculation, validation);

      // Log successful calculation
      logMedicalQuery(
        `Dosage calculation: ${params.drugName} for ${params.weight}kg patient`,
        undefined,
        Date.now()
      );

      return formattedResult;

    } catch (error) {
      logger.error('Dosage calculation failed:', error);

      if (error instanceof MedicalDataError) {
        return `Rate limit exceeded: ${error.message}`;
      }

      return `Error calculating dosage: ${error.message}. Please check your input and try again.`;
    }
  }
}