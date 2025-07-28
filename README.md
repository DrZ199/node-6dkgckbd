# NelsonGPT - Evidence-Based Pediatric Medical Assistant

A modern, ChatGPT-style progressive web application (PWA) designed specifically for pediatric healthcare professionals. NelsonGPT provides evidence-based medical guidance powered by the Nelson Textbook of Pediatrics, featuring real-time RAG (Retrieval Augmented Generation) capabilities, drug dosage calculations, and emergency protocols.

![NelsonGPT](./docs/screenshot.png)

## 🎯 Features

### Medical Capabilities
- **Evidence-Based Responses**: All answers backed by Nelson Textbook of Pediatrics
- **Drug Dosage Calculator**: Automated pediatric dosing with weight/age considerations
- **Emergency Protocols**: Step-by-step resuscitation and emergency procedures
- **Symptom Analysis**: Differential diagnosis assistance
- **Growth & Development**: Milestone tracking and growth chart interpretation

### Technical Features
- **Progressive Web App (PWA)**: Installable on mobile and desktop
- **ChatGPT-Style Interface**: Familiar chat experience with dark medical theme
- **Offline Capability**: Service worker caching for core functionality
- **Real-time RAG**: Vector similarity search over medical content
- **Voice Input**: Speech-to-text for hands-free operation
- **Responsive Design**: Optimized for mobile, tablet, and desktop

### AI & RAG Integration
- **LangChain**: Prompt templating and conversation memory
- **LangGraph**: Multi-agent orchestration for complex medical queries
- **Mistral AI**: Advanced language model for medical responses
- **Supabase Vector DB**: pgvector for semantic search
- **HuggingFace Embeddings**: sentence-transformers for text embeddings

## 🏗️ Technology Stack

### Frontend
- **React 19** - Latest React with concurrent features
- **TypeScript** - Type-safe development
- **Tailwind CSS V4** - Utility-first styling with medical theme
- **ShadCN UI** - High-quality component library
- **Vite** - Fast build tool and development server
- **PWA Plugin** - Progressive web app capabilities

### Backend & AI
- **Supabase** - PostgreSQL with pgvector extension
- **Mistral AI** - Large language model
- **HuggingFace** - Transformer models for embeddings
- **LangChain** - LLM application framework
- **LangGraph** - Multi-agent workflows

### Medical Data
- **Nelson Textbook of Pediatrics** - Primary medical knowledge base
- **Structured Drug Database** - Pediatric dosing information
- **Emergency Protocols** - Step-by-step medical procedures
- **Growth Charts** - CDC growth and development data

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ 
- Bun (recommended) or npm/yarn
- Supabase account
- Mistral AI API key
- HuggingFace API key

### Installation

1. **Clone and install dependencies**
   ```bash
   git clone <repository-url>
   cd nelsongpt
   bun install  # or npm install
   ```

2. **Environment Setup**
   ```bash
   cp .env.example .env
   ```
   
   Update `.env` with your API keys:
   ```env
   VITE_SUPABASE_URL=your_supabase_project_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   VITE_SUPABASE_SERVICE_KEY=your_supabase_service_role_key
   VITE_MISTRAL_API_KEY=your_mistral_api_key
   VITE_HUGGINGFACE_API_KEY=your_huggingface_api_key
   ```

3. **Database Setup**
   - Create a new Supabase project
   - Enable the `vector` extension in SQL Editor
   - Run the SQL commands from `schema.txt` to create tables
   - The schema includes sample medical data to get started

4. **Development Server**
   ```bash
   bun dev  # or npm run dev
   ```
   
   Open [http://localhost:5173](http://localhost:5173) in your browser.

5. **Build for Production**
   ```bash
   bun build  # or npm run build
   ```

## 🏥 Medical Use Cases

### Symptom Analysis
```
User: "3-year-old with fever, ear pain, and decreased hearing"
NelsonGPT: Provides differential diagnosis for otitis media with evidence-based treatment recommendations
```

### Drug Dosage Calculation
```
User: "Amoxicillin dosage for 15kg child with otitis media"
NelsonGPT: Calculates 80mg/kg/day = 1200mg/day divided into 2-3 doses, with safety warnings
```

### Emergency Protocols
```
User: "Neonatal resuscitation steps"
NelsonGPT: Step-by-step protocol with timing, equipment needed, and drug dosages
```

### Growth Assessment
```
User: "How to interpret growth charts for 18-month-old"
NelsonGPT: Explains percentile interpretation and red flags for further evaluation
```

## 📱 PWA Installation

### Mobile (iOS/Android)
1. Open the app in Safari (iOS) or Chrome (Android)
2. Tap the "Share" button or "Menu" (⋮)
3. Select "Add to Home Screen"
4. Confirm installation

### Desktop
1. Open the app in Chrome, Edge, or Safari
2. Look for the install icon in the address bar
3. Click "Install NelsonGPT"
4. The app will be available in your applications

## 🔧 Configuration

### Medical Content Customization
- Add medical content to Supabase tables
- Generate embeddings using HuggingFace API
- Update drug dosage database for specific protocols
- Customize emergency protocols for your institution

### Theme Customization
- Modify `src/index.css` for color scheme changes
- Update medical icons and branding
- Customize chat interface components

### API Integration
- Configure rate limiting for production
- Set up monitoring for API usage
- Implement user authentication if needed

## 🔒 Security & Compliance

### Medical Data Handling
- All patient data processed locally or securely transmitted
- No persistent storage of patient-specific information
- Compliance with HIPAA guidelines for medical applications

### API Security
- Secure API key management
- Rate limiting on medical queries
- Audit logging for medical consultations

### Data Privacy
- No tracking or analytics on medical queries
- Local storage for chat history only
- Clear data retention policies

## 📊 Database Schema

The application uses a comprehensive medical database schema:

### Core Tables
- `nelson_book_of_pediatrics` - Textbook content with embeddings
- `pediatric_drug_dosages` - Age-specific dosing information
- `emergency_protocols` - Step-by-step medical procedures
- `growth_development` - Growth charts and milestones
- `chat_sessions` - User conversation history

### Vector Search
- pgvector extension for semantic similarity
- 384-dimensional embeddings from sentence-transformers
- Cosine similarity for medical content retrieval

## 🧪 Testing & Development

### Comprehensive Testing Suite
```bash
# Run all tests
bun test

# Unit tests with coverage
bun test:coverage

# Interactive test UI
bun test:ui

# End-to-end tests
bun test:e2e

# E2E tests with UI
bun test:e2e:ui

# Medical-specific tests
bun test src/lib/__tests__/

# Authentication tests
bun test src/lib/__tests__/auth.test.ts
```

### Mobile App Development
```bash
# Build for mobile platforms
bun build

# Sync Capacitor
bun mobile:sync

# Run on Android
bun mobile:android

# Run on iOS
bun mobile:ios
```

### Security & Compliance Testing
```bash
# Test authentication flows
bun test:e2e auth.spec.ts

# Test rate limiting
bun test src/lib/__tests__/rateLimit.test.ts

# Test HIPAA compliance features
bun test src/lib/__tests__/hipaa.test.ts
```

## 📈 Performance Optimization

### Frontend Optimization
- React 19 concurrent rendering
- Code splitting for medical modules
- Lazy loading of heavy components
- Service worker caching strategies

### Backend Optimization
- Vector index optimization for fast search
- Connection pooling for database
- Caching strategies for common queries
- API response compression

## 🤝 Contributing

### Medical Content
- Submit evidence-based medical updates
- Provide peer-reviewed references
- Follow medical writing guidelines
- Maintain clinical accuracy standards

### Code Contributions
- Follow TypeScript best practices
- Maintain test coverage
- Document medical-specific functionality
- Ensure accessibility compliance

## 📋 Deployment

### Vercel (Recommended)
1. Connect your GitHub repository
2. Configure environment variables
3. Deploy with automatic PWA optimization

### Self-Hosted
1. Build the production bundle
2. Configure web server (nginx/Apache)
3. Set up HTTPS for PWA requirements
4. Configure service worker caching

## ⚠️ Medical Disclaimer

**This application is for educational and reference purposes only. It is not intended to replace professional medical judgment or provide direct patient care recommendations. Always consult with qualified healthcare professionals for medical decisions and patient care.**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🆘 Support

### Medical Questions
- Consult the Nelson Textbook of Pediatrics directly
- Reach out to pediatric medical professionals
- Use established clinical guidelines

### Technical Support
- Check the GitHub issues for common problems
- Review the documentation for setup instructions
- Contact the development team for technical assistance

## 🙏 Acknowledgments

- **Nelson Textbook of Pediatrics** - Primary medical knowledge source
- **Mistral AI** - Language model capabilities
- **Supabase** - Vector database and backend services
- **HuggingFace** - Transformer models and embeddings
- **Medical Community** - Clinical expertise and validation

---

**Built with ❤️ for pediatric healthcare professionals**