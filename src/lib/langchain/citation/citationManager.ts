import { logger } from '../../logger';

export interface Citation {
  id: string;
  source: string;
  page?: number;
  chapter?: string;
  section?: string;
  subsection?: string;
  relevance: number;
  text_snippet?: string;
  last_updated?: string;
}

export interface MedicalContent {
  id: string;
  title: string;
  content: string;
  chapter: string;
  page: number;
  section?: string;
  subsection?: string;
  tags?: string[];
  similarity?: number;
  updated_at?: string;
}

export class CitationManager {
  private lastCitations: Citation[] = [];
  private citationCounter = 1;

  constructor() {
    this.lastCitations = [];
    this.citationCounter = 1;
  }

  // Build context with proper citations
  buildContextWithCitations(searchResults: MedicalContent[]): string {
    this.lastCitations = [];
    this.citationCounter = 1;

    if (!searchResults || searchResults.length === 0) {
      return 'No relevant medical information found in the Nelson Textbook database.';
    }

    let context = '';
    
    searchResults.forEach((result, index) => {
      const citation = this.createCitation(result);
      this.lastCitations.push(citation);

      // Add to context with citation marker
      context += `**Content ${this.citationCounter}:** ${result.content}\n`;
      context += `**Citation:** ${this.formatCitationInline(citation)}\n\n`;
      
      this.citationCounter++;
    });

    return context;
  }

  // Create citation from medical content
  private createCitation(content: MedicalContent): Citation {
    const citation: Citation = {
      id: `citation_${this.citationCounter}`,
      source: this.formatNelsonSource(content),
      page: content.page,
      chapter: content.chapter,
      section: content.section,
      subsection: content.subsection,
      relevance: content.similarity || 0.8,
      text_snippet: this.extractSnippet(content.content),
      last_updated: content.updated_at,
    };

    return citation;
  }

  // Format Nelson Textbook source
  private formatNelsonSource(content: MedicalContent): string {
    let source = 'Nelson Textbook of Pediatrics';
    
    if (content.chapter) {
      source += `, ${content.chapter}`;
    }
    
    if (content.section && content.section !== content.chapter) {
      source += ` - ${content.section}`;
    }
    
    if (content.subsection && content.subsection !== content.section) {
      source += ` (${content.subsection})`;
    }

    return source;
  }

  // Format inline citation
  private formatCitationInline(citation: Citation): string {
    let inlineCitation = '';
    
    if (citation.chapter && citation.page) {
      inlineCitation = `Nelson, pg. ${citation.page}`;
    } else if (citation.page) {
      inlineCitation = `Nelson, pg. ${citation.page}`;
    } else {
      inlineCitation = 'Nelson Textbook of Pediatrics';
    }

    return inlineCitation;
  }

  // Extract text snippet for citation
  private extractSnippet(content: string, maxLength: number = 150): string {
    if (!content) return '';
    
    // Clean up the content
    const cleanContent = content
      .replace(/\n+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanContent.length <= maxLength) {
      return cleanContent;
    }

    // Find a good break point near the max length
    const snippet = cleanContent.substring(0, maxLength);
    const lastSpace = snippet.lastIndexOf(' ');
    
    if (lastSpace > maxLength * 0.7) {
      return snippet.substring(0, lastSpace) + '...';
    }
    
    return snippet + '...';
  }

  // Get formatted citations for response
  getFormattedCitations(): string {
    if (this.lastCitations.length === 0) {
      return '';
    }

    let formattedCitations = '\n\n**References:**\n';
    
    this.lastCitations.forEach((citation, index) => {
      formattedCitations += `${index + 1}. ${citation.source}`;
      
      if (citation.page) {
        formattedCitations += `, pg. ${citation.page}`;
      }
      
      if (citation.relevance && citation.relevance < 1.0) {
        formattedCitations += ` (relevance: ${(citation.relevance * 100).toFixed(0)}%)`;
      }
      
      formattedCitations += '\n';
    });

    return formattedCitations;
  }

  // Get last citations
  getLastCitations(): Citation[] {
    return [...this.lastCitations];
  }

  // Reset citations
  resetCitations(): void {
    this.lastCitations = [];
    this.citationCounter = 1;
  }

  // Validate citation format
  validateCitation(citation: Citation): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    
    if (!citation.source) {
      errors.push('Citation must have a source');
    }
    
    if (!citation.page && !citation.chapter) {
      errors.push('Citation must have either a page number or chapter reference');
    }
    
    if (citation.relevance < 0 || citation.relevance > 1) {
      errors.push('Citation relevance must be between 0 and 1');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  // Create bibliography from multiple citations
  createBibliography(citations: Citation[]): string {
    if (citations.length === 0) {
      return '';
    }

    let bibliography = '**Bibliography:**\n\n';
    
    // Group citations by chapter
    const citationsByChapter = this.groupCitationsByChapter(citations);
    
    Object.keys(citationsByChapter).forEach(chapter => {
      bibliography += `**${chapter}:**\n`;
      
      citationsByChapter[chapter].forEach(citation => {
        bibliography += `- ${citation.source}`;
        if (citation.page) {
          bibliography += `, pg. ${citation.page}`;
        }
        bibliography += '\n';
      });
      
      bibliography += '\n';
    });

    return bibliography;
  }

  // Group citations by chapter
  private groupCitationsByChapter(citations: Citation[]): Record<string, Citation[]> {
    const grouped: Record<string, Citation[]> = {};
    
    citations.forEach(citation => {
      const chapter = citation.chapter || 'General';
      
      if (!grouped[chapter]) {
        grouped[chapter] = [];
      }
      
      grouped[chapter].push(citation);
    });
    
    return grouped;
  }

  // Create standard medical citation
  createStandardCitation(params: {
    authors?: string[];
    title: string;
    journal?: string;
    volume?: string;
    issue?: string;
    pages?: string;
    year: number;
    doi?: string;
  }): string {
    let citation = '';
    
    if (params.authors && params.authors.length > 0) {
      if (params.authors.length === 1) {
        citation += `${params.authors[0]}. `;
      } else if (params.authors.length <= 3) {
        citation += `${params.authors.join(', ')}. `;
      } else {
        citation += `${params.authors[0]} et al. `;
      }
    }
    
    citation += `${params.title}. `;
    
    if (params.journal) {
      citation += `${params.journal}. `;
    }
    
    citation += `${params.year}`;
    
    if (params.volume) {
      citation += `;${params.volume}`;
      
      if (params.issue) {
        citation += `(${params.issue})`;
      }
      
      if (params.pages) {
        citation += `:${params.pages}`;
      }
    }
    
    citation += '.';
    
    if (params.doi) {
      citation += ` doi:${params.doi}`;
    }
    
    return citation;
  }

  // Extract page numbers from text
  extractPageReferences(text: string): number[] {
    const pageRegex = /(?:pg?\.?\s*|page\s+)(\d+)/gi;
    const pages: number[] = [];
    let match;
    
    while ((match = pageRegex.exec(text)) !== null) {
      const pageNum = parseInt(match[1]);
      if (pageNum > 0 && pageNum < 10000) { // Reasonable page range
        pages.push(pageNum);
      }
    }
    
    return [...new Set(pages)]; // Remove duplicates
  }

  // Validate Nelson citation format
  validateNelsonCitation(citation: string): { isValid: boolean; suggestions: string[] } {
    const suggestions: string[] = [];
    let isValid = true;
    
    // Check for Nelson reference
    if (!citation.toLowerCase().includes('nelson')) {
      suggestions.push('Citation should reference Nelson Textbook of Pediatrics');
      isValid = false;
    }
    
    // Check for page number
    const hasPageNumber = /pg?\.?\s*\d+/i.test(citation);
    if (!hasPageNumber) {
      suggestions.push('Citation should include a page number (e.g., "pg. 123")');
      isValid = false;
    }
    
    // Check format consistency
    const standardFormats = [
      /Nelson,?\s+pg?\.?\s*\d+/i,
      /Nelson Textbook of Pediatrics,?\s+pg?\.?\s*\d+/i,
      /Nelson.*,?\s+pg?\.?\s*\d+/i
    ];
    
    const hasStandardFormat = standardFormats.some(format => format.test(citation));
    if (!hasStandardFormat) {
      suggestions.push('Use standard format: "Nelson, pg. XXX" or "Nelson Textbook of Pediatrics, pg. XXX"');
    }
    
    return { isValid, suggestions };
  }

  // Create citation statistics
  getCitationStatistics(): {
    totalCitations: number;
    averageRelevance: number;
    chapterDistribution: Record<string, number>;
    pageRange: { min: number; max: number } | null;
  } {
    if (this.lastCitations.length === 0) {
      return {
        totalCitations: 0,
        averageRelevance: 0,
        chapterDistribution: {},
        pageRange: null
      };
    }
    
    const totalRelevance = this.lastCitations.reduce((sum, citation) => sum + citation.relevance, 0);
    const averageRelevance = totalRelevance / this.lastCitations.length;
    
    const chapterDistribution: Record<string, number> = {};
    const pages: number[] = [];
    
    this.lastCitations.forEach(citation => {
      const chapter = citation.chapter || 'Unknown';
      chapterDistribution[chapter] = (chapterDistribution[chapter] || 0) + 1;
      
      if (citation.page) {
        pages.push(citation.page);
      }
    });
    
    const pageRange = pages.length > 0 
      ? { min: Math.min(...pages), max: Math.max(...pages) }
      : null;
    
    return {
      totalCitations: this.lastCitations.length,
      averageRelevance: Number(averageRelevance.toFixed(3)),
      chapterDistribution,
      pageRange
    };
  }

  // Log citation usage for analytics
  logCitationUsage(queryType: string, userId?: string): void {
    const stats = this.getCitationStatistics();
    
    logger.info('Citation usage logged', {
      query_type: queryType,
      user_id: userId,
      citation_count: stats.totalCitations,
      average_relevance: stats.averageRelevance,
      chapters_referenced: Object.keys(stats.chapterDistribution).length,
    });
  }
}